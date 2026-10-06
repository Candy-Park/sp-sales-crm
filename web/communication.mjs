const kinds={hq_draft:'HQ 영문 초안',customer_draft:'고객 한국어 초안',hq_sent:'HQ 실제 발송',customer_sent:'고객 실제 회신',hq_received:'HQ 답변 원문',customer_received:'고객 답변 원문'};
const states={open:'미답변',partial:'부분 답변',answered:'답변 완료',cancelled:'사유 있는 취소'};
const localTime=iso=>iso?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T'):'';
const toIso=value=>value?(value.length===16?value+':00':value)+'+09:00':null;
export function initCommunication({api,message,refresh,onQuestions}){
 const el=id=>document.getElementById(id);
 let inquiry=null,actions=[],messages=[],questions=[],generation=0,loadVersion=0,pending=false;
 let messageId=crypto.randomUUID(),questionId=crypto.randomUUID();
 const add=(parent,tag,text)=>{const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;};
 const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
 function select(node,rows,empty='선택 안 함'){
  const previous=node.value;node.replaceChildren(option('',empty),...rows.map(r=>option(r.id,r.label)));
  if(rows.some(r=>r.id===previous))node.value=previous;
 }
 function mode(){
  const kind=el('communication-kind').value,draft=kind.endsWith('_draft'),sent=kind.endsWith('_sent');
  el('communication-occurrence').hidden=draft;el('communication-time').required=!draft;
  el('communication-send-options').hidden=!sent;el('communication-confirmed').required=sent;
  if(draft){el('communication-time').value='';el('communication-confirmed').checked=false;}
  if(!draft&&!el('communication-time').value)el('communication-time').value=localTime(new Date().toISOString());
  el('communication-question-choices').hidden=!['hq_draft','hq_sent'].includes(kind);
  el('communication-translation-fields').hidden=!kind.endsWith('_received');
  const sourceKinds={hq_sent:['hq_draft'],customer_sent:['customer_draft'],hq_received:['hq_sent'],customer_received:['customer_sent'],hq_draft:['hq_received','customer_received'],customer_draft:['hq_received','customer_received']}[kind];
  select(el('communication-source'),messages.filter(m=>sourceKinds.includes(m.kind)).map(m=>({id:m.id,label:kinds[m.kind]+' · '+(m.subject||m.body.slice(0,50))})));
  select(el('communication-action'),actions.filter(a=>a.status==='open'&&a.kind===(kind==='hq_sent'?'hq_inquiry':kind==='customer_sent'?'customer_reply':'')).map(a=>({id:a.id,label:a.description})));
  el('communication-save').textContent=draft?'초안 저장':sent?'실제 발송 사실 기록':'받은 답변 원문 저장';
 }
 function reviewForm(parent,q,reviews){
  add(parent,'strong',q.question+' · '+states[q.status]);
  if(q.note)add(parent,'p','현재 검토: '+q.note);
  if(reviews.length){const history=add(parent,'details','');add(history,'summary','이전 검토 근거');for(const r of reviews){add(history,'p',`${states[r.status]} · ${r.note} · ${localTime(r.created_at).replace('T',' ')} 서울`);}}
  if(inquiry.status==='closed')return;
  const form=add(parent,'form',''),statusLabel=add(form,'label','질문 검토 상태'),status=add(statusLabel,'select','');status.className='form-select';
  for(const [value,label]of Object.entries(states))status.append(option(value,label));status.value=q.status;
  const responseLabel=add(form,'label','근거 HQ 답변 원문'),response=add(responseLabel,'select','');response.className='form-select';
  select(response,messages.filter(m=>m.kind==='hq_received').map(m=>({id:m.id,label:(m.subject||m.body.slice(0,50))+' · '+localTime(m.occurred_at)})));response.value=q.response_message_id??'';
  const noteLabel=add(form,'label','검토 근거·미답변 항목·취소 사유'),note=add(noteLabel,'textarea','');note.className='form-control';note.maxLength=2000;note.value=q.note;
  const button=add(form,'button','질문 검토 저장');button.className='btn btn-outline-secondary';
  const feedback=add(form,'p','');feedback.className='message';feedback.setAttribute('role','status');
  const epoch=generation;
  form.addEventListener('submit',async e=>{e.preventDefault();if(pending)return;pending=true;button.disabled=true;feedback.textContent='검토를 저장하고 있습니다.';
   try{await api('/api/questions/'+q.id,'PATCH',{revision:q.revision,status:status.value,response_message_id:status.value==='cancelled'?null:response.value||null,note:note.value});if(epoch!==generation)return;await load();}
   catch(e){if(epoch===generation)feedback.textContent=e.message;}
   finally{if(epoch===generation){pending=false;if(button.isConnected)button.disabled=false;}}
  });
 }
 function render(data){
  messages=data.messages;questions=data.questions;
  const qlist=el('hq-questions');qlist.replaceChildren();
  for(const q of questions){const row=add(qlist,'article','');row.className='action-editor';reviewForm(row,q,data.reviews.filter(r=>r.question_id===q.id));}
  if(!questions.length)add(qlist,'p','아직 등록한 HQ 질문이 없습니다.');
  const checked=new Set([...el('communication-question-choices').querySelectorAll('input:checked')].map(n=>n.value));
  const choices=el('communication-question-choices');choices.replaceChildren();if(questions.length)add(choices,'p','이 기록에 연결할 HQ 질문 (선택)');
  for(const q of questions){const label=add(choices,'label',''),box=add(label,'input','');box.type='checkbox';box.value=q.id;box.checked=checked.has(q.id);add(label,'span',' '+q.question+' · '+states[q.status]);}
  const history=el('communication-history');history.replaceChildren();
  for(const m of messages){const item=add(history,'li','');add(item,'strong',kinds[m.kind]+' · '+m.target);add(item,'p',(m.subject||'제목 없음')+' · '+localTime(m.occurred_at??m.created_at).replace('T',' ')+' 서울');add(item,'pre',m.body).className='original-text';
   if(m.translation){add(item,'p','수동 번역 (원문 별도 보존)');add(item,'pre',m.translation).className='original-text';}
   if(m.summary)add(item,'p','수동 요약: '+m.summary);
   if(m.question_snapshot?.length)add(item,'p','연결한 질문: '+m.question_snapshot.map(q=>q.question).join(' / '));
   if(m.kind.endsWith('_draft')&&inquiry.status!=='closed'){const button=add(item,'button','이 초안으로 실제 발송 기록 입력');button.type='button';button.className='btn btn-outline-secondary';button.addEventListener('click',()=>{
    el('communication-form').reset();messageId=crypto.randomUUID();el('communication-kind').value=m.kind==='hq_draft'?'hq_sent':'customer_sent';
    el('communication-target').value=m.target;el('communication-subject').value=m.subject;el('communication-body').value=m.body;mode();el('communication-source').value=m.id;
    for(const box of choices.querySelectorAll('input'))box.checked=(m.question_ids??[]).includes(box.value);
    message('communication-save-status','초안을 입력에 불러왔습니다. 실제 발송한 최종 내용과 시각을 확인한 뒤 기록하세요.');
   });}
  }
  if(!messages.length)add(history,'li','아직 저장한 초안·발송·답변 기록이 없습니다.');
  mode();
  const unanswered=questions.filter(q=>['open','partial'].includes(q.status)).length;
  onQuestions(inquiry.id,unanswered,data.truncated);
  message('communication-status',data.truncated?'최근 1,000개까지만 조회했습니다. 전체 질문 확인 전 문의를 종료할 수 없습니다.':`HQ 미답변·부분 답변 ${unanswered}개. 받은 답변만으로 질문을 자동 완료하지 않습니다.`);
 }
 async function load(){
  if(!inquiry)return;const epoch=generation,version=++loadVersion,id=inquiry.id;
  onQuestions(id,0,true);message('communication-status','원문과 질문 검토 이력을 불러오고 있습니다.');
  try{const data=await api('/api/inquiries/'+id+'/communication');if(epoch!==generation||version!==loadVersion)return;render(data);}
  catch(e){if(epoch===generation&&version===loadVersion){onQuestions(id,0,true);message('communication-status',e.message,true);}}
 }
 el('communication-kind').addEventListener('change',mode);
 el('communication-reload').addEventListener('click',load);
 el('communication-copy').addEventListener('click',async()=>{
  const epoch=generation;
  try{await navigator.clipboard.writeText(el('communication-body').value);if(epoch===generation)message('communication-save-status','본문을 복사했습니다. 발송 기록이나 대기 상태는 바뀌지 않았습니다.');}
  catch{if(epoch===generation)message('communication-save-status','복사 권한을 확인하거나 본문을 직접 선택해 복사해주세요.',true);}
 });
 el('communication-reset').addEventListener('click',()=>{el('communication-form').reset();messageId=crypto.randomUUID();mode();message('communication-save-status','새 기록 입력을 시작합니다.');});
 el('hq-question-reset').addEventListener('click',()=>{el('hq-question-form').reset();questionId=crypto.randomUUID();message('hq-question-status','새 질문 입력을 시작합니다.');});
 el('hq-question-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!inquiry||pending)return;pending=true;const epoch=generation;const button=e.currentTarget.querySelector('button');button.disabled=true;
  try{await api('/api/inquiries/'+inquiry.id+'/questions','POST',{id:questionId,question:el('hq-question-text').value});if(epoch!==generation)return;
   el('hq-question-form').reset();questionId=crypto.randomUUID();message('hq-question-status','HQ 질문을 저장했습니다.');await load();
  }catch(e){if(epoch===generation)message('hq-question-status',e.message,true);}
  finally{if(epoch===generation){pending=false;button.disabled=false;}}
 });
 el('communication-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!inquiry||pending)return;pending=true;const epoch=generation,id=inquiry.id,button=el('communication-save');button.disabled=true;
  const kind=el('communication-kind').value,draft=kind.endsWith('_draft'),sent=kind.endsWith('_sent');
  const body={id:messageId,kind,target:el('communication-target').value,subject:el('communication-subject').value,body:el('communication-body').value,
   occurred_at:draft?null:toIso(el('communication-time').value),actual_confirmed:sent&&el('communication-confirmed').checked,source_id:el('communication-source').value||null,
   action_id:sent?el('communication-action').value||null:null,question_ids:['hq_draft','hq_sent'].includes(kind)?[...el('communication-question-choices').querySelectorAll('input:checked')].map(n=>n.value):[],
   translation:kind.endsWith('_received')?el('communication-translation').value:'',summary:kind.endsWith('_received')?el('communication-summary').value:''};
  try{await api('/api/inquiries/'+id+'/messages','POST',body);if(epoch!==generation)return;
   messageId=crypto.randomUUID();el('communication-form').reset();await refresh(id);
   if(inquiry?.id===id)message('communication-save-status',draft?'초안을 저장했습니다. 발송 기록이나 대기 상태는 바뀌지 않았습니다.':'실제 발송·수신 기록을 저장했습니다. 문의 상태와 이력을 다시 확인하세요.');
  }catch(e){if(epoch===generation)message('communication-save-status',e.message,true);}
  finally{if(epoch===generation){pending=false;if(button.isConnected)button.disabled=false;}}
 });
 function reset(){generation++;loadVersion++;inquiry=null;actions=[];messages=[];questions=[];pending=false;messageId=crypto.randomUUID();questionId=crypto.randomUUID();
  for(const id of ['hq-questions','communication-history','communication-question-choices'])el(id).replaceChildren();
  for(const id of ['communication-form','hq-question-form']){el(id).reset();for(const button of el(id).querySelectorAll('button'))button.disabled=false;}
  for(const id of ['communication-status','communication-save-status','hq-question-status'])message(id,'');
  select(el('communication-source'),[]);select(el('communication-action'),[]);mode();
 }
 return {bind(i,a){generation++;inquiry=i;actions=a;el('hq-question-form').hidden=i.status==='closed';el('communication-form').hidden=i.status==='closed';mode();load();},deactivate(){generation++;loadVersion++;inquiry=null;pending=false;},reset};
}

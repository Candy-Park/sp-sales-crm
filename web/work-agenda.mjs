export function agendaGroups(threads,dashboard){
 const rows=new Map(),groups={action:[],waiting:[],decision:[],done:[]};
 for(const t of threads)rows.set(t.inquiry_id,{...t.current,id:t.inquiry_id,thread:t,actions:t.current.actions.filter(a=>a.status==='open')});
 for(const i of dashboard.inquiries||[])if(!rows.has(i.id))rows.set(i.id,{...i,actions:[]});
 for(const a of dashboard.actions||[]){
  if(!rows.has(a.inquiry_id))rows.set(a.inquiry_id,{id:a.inquiry_id,title:'저장된 업무',actions:[]});
  const row=rows.get(a.inquiry_id);if(!row.actions.some(saved=>saved.id===a.id))row.actions.push(a);
 }
 for(const row of rows.values()){
  const bucket=row.review?.task_bucket,t=row.thread;
  const key=row.status==='closed'||(!row.actions.length&&bucket==='responded')?'done':
   t&&!t.confirmed_review||!row.actions.length?'decision':
   bucket==='waiting'||row.actions.every(a=>a.waiting_target)?'waiting':'action';
  groups[key].push(row);
 }
 for(const list of Object.values(groups))list.sort((a,b)=>(a.actions.map(x=>x.due_date||'9999').sort()[0]||'9999').localeCompare(b.actions.map(x=>x.due_date||'9999').sort()[0]||'9999'));
 return groups;
}
export function initWorkAgenda({root,api,isConnected,open,onCounts=()=>{}}){
 let epoch=0;const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const heading=make('h2','오늘의 업무'),status=make('p','CRM 연결 후 저장된 업무와 메일 변화를 함께 표시합니다.'),reload=make('button','업무 다시 확인'),list=make('div','');reload.type='button';root.append(heading,status,reload,list);
 async function load(){
  if(!isConnected())return;const active=++epoch;reload.disabled=true;
  try{
   const [analysis,dashboard]=await Promise.all([api('/api/followups?view=analysis'),api('/api/dashboard')]);
   if(active!==epoch||!isConnected())return;
   const groups=agendaGroups(analysis.threads,dashboard);list.replaceChildren();onCounts(groups);
   for(const [key,label] of [['action','내가 할 일'],['waiting','상대 답변·처리 대기'],['decision','판단 필요'],['done','회신 완료·종료 이력']]){
    const section=make(key==='done'?'details':'section','');section.className='task-section';section.append(make(key==='done'?'summary':'h3',`${label} · ${groups[key].length}`));
    for(const row of groups[key]){
     const card=make('article','');card.className='task-card';card.append(make('h3',row.review?.task_title||row.title));
     card.append(make('p','담당: '+(row.review?.task_owner||row.actions.find(a=>a.waiting_target)?.waiting_target||'담당자 확인 필요')));
     for(const a of row.actions)card.append(make('p',`${a.description||'내용 확인 필요'} · ${a.due_date?'기한 '+a.due_date:'확인일 미지정'}`));
     if(!row.actions.length&&row.next_action)card.append(make('p',row.next_action));
     if(row.thread){
      const t=row.thread,last=t.timeline.at(-1);card.append(make('p',`받은 ${t.received} / 보낸 ${t.sent} · ${t.confirmed_review?'확인한 업무 유지':'메일 변화 검토 필요'}`));
      if(last)card.append(make('p',`마지막 ${last.direction==='sent'?'발신':'수신'}: ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(last.occurred_at))}`));
      const proof=make('details','');proof.append(make('summary','근거 메일 펼치기'));
      for(const m of t.timeline){proof.append(make('p',`${m.direction==='sent'?'보낸':'받은'} · ${m.occurred_at}`),make('pre',m.held?'인증정보 가능성·긴 본문으로 표시 보류':m.excerpt||'본문 없음'));}card.append(proof);
     }
     const button=make('button','업무 열기 · 수정/기한 연장');button.type='button';button.addEventListener('click',()=>open(row.id));card.append(button);section.append(card);
    }
    if(!groups[key].length)section.append(make('p','해당 업무가 없습니다.'));list.append(section);
   }
   status.textContent=dashboard.truncated?'저장 업무는 최근 100건 범위입니다. 문의 조회에서 전체를 확인하세요.':'업무별 한 번만 표시합니다. 메일 수신·발신은 관측 사실이며 완료를 자동 확정하지 않습니다.';
  }catch(error){if(active===epoch){status.textContent=error.message;list.replaceChildren();}}
  finally{if(active===epoch)reload.disabled=!isConnected();}
 }
 reload.addEventListener('click',()=>void load());
 return {start(){void load();},stop(){epoch++;list.replaceChildren();reload.disabled=true;status.textContent='CRM 연결 후 저장된 업무와 메일 변화를 함께 표시합니다.';}};
}

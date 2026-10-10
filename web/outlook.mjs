import {classificationRoles} from '../src/outlook.mjs';
const businessCategories=['고객 업무','HQ 업무'];
const el=id=>document.getElementById(id);
const seoul=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export function initOutlook({api,message,show,open,onList=()=>{}}){
  let epoch=0,offset=0,view='active',selected=null,registrationId=crypto.randomUUID(),timer=null,inquiryOffset=0,reviewSequence=0,listSequence=0;
  const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
  let category='all',classification='all',labelRequest=null,listedHandling=new Map();
  el('outlook-category-filter').replaceChildren(option('all','전체 업무 분류'),...businessCategories.map(v=>option(v,v)));
  el('outlook-role').replaceChildren(option('','상대 관계 선택'),...classificationRoles.map(v=>option(v,v)));
  el('outlook-category').replaceChildren(option('','업무 분류 선택'),...businessCategories.map(v=>option(v,v)));
  function classificationControls(disabled){for(const id of ['outlook-role','outlook-category','outlook-classify'])el(id).disabled=disabled;}
  const report=error=>message('outlook-message',error.message,true);
  function clearReview(){reviewSequence++;selected=null;labelRequest=null;el('outlook-review').hidden=true;for(const name of ['body','meta','subject','triage-note','proposal','label','workflow-preview'])el('outlook-'+name).textContent='';el('outlook-workflow').disabled=false;el('outlook-role').value='';el('outlook-category').value='';classificationControls(false);el('outlook-link-form').hidden=true;el('outlook-linked-open').hidden=true;el('outlook-triage').hidden=true;}
  async function status(){
    clearTimeout(timer);
    const active=epoch;
    try{
      const data=await api('/api/outlook/local');if(active!==epoch)return;
      const period=data.window_start?`${seoul(data.window_start)} 이상 ~ ${seoul(data.window_end)} 미만 (서울)`:'승인된 최근 1개월 스냅샷';
      const sync=data.review_sync,approved=data.approved_period;
      el('outlook-status').textContent=`로컬 보관 범위: ${period} · 로컬 ${data.total??'—'}건 · 서버 영수증 ${data.receipted??'—'}건 · 미전송 ${data.pending??'—'}건 · 긴 본문 보류 ${data.held??'—'}건. ${data.running?'수집·전송 중':data.error||data.last_error||sync?.error?'오류: '+(data.error||data.last_error||sync.error):'대기'}. 마지막 메일 전송 성공: ${data.last_success_at?seoul(data.last_success_at):'없음'}${approved?` · 직접 재수집 대상: ${seoul(approved.start)}~${seoul(approved.end)}`:''}${sync?` · 제안 연결 ${sync.proposals}건, 확인 사례 ${sync.seeded_labels}건, 기존 확정 충돌로 건너뜀 ${sync.preserved_labels}건`:''}`;
      el('outlook-start').disabled=Boolean(data.running);
      el('outlook-review-sync').disabled=Boolean(data.running);
      if(data.running)timer=setTimeout(status,2500);
    }catch(error){if(active===epoch)report(error);}
  }
  async function list(){
    const active=epoch,sequence=++listSequence;
    try{
      const data=await api('/api/outlook?offset='+offset+'&view='+view+(category==='all'?'':'&category='+encodeURIComponent(category))+(classification==='all'?'':'&classification='+classification));if(active!==epoch||sequence!==listSequence)return;
      onList(data.mails,view);
      el('outlook-list').replaceChildren();
      listedHandling=new Map(data.mails.filter(m=>m.handling).map(m=>[m.id,m.handling]));
      if(el('outlook-handling-summary'))el('outlook-handling-summary').textContent=data.summary?`사용자 확인 ${data.summary.reviewed}건 · 담당 업무 ${data.summary.business}건 · 등록 불필요 ${data.summary.skipped}건. 확인한 표본 기준이며 전체 받은 메일의 자동 분류 결과는 아닙니다.`:'';
      for(const mail of data.mails){
        const li=document.createElement('li'),button=document.createElement('button'),hint=document.createElement('small');
        button.textContent=mail.subject||'(제목 없음)';button.addEventListener('click',()=>review(mail.id));
        hint.textContent=`${mail.direction==='sent'?'보낸':'받은'} · ${seoul(mail.occurred_at)} · ${mail.excluded?'업무 제외 · ':''}${mail.state==='held'?'보류: 긴 본문 로컬 원문 보존':mail.state==='linked'?'문의 연결됨':'검토 대기'}`;
        if(!mail.handling)hint.textContent+=mail.label?` · 사용자 확정: ${mail.label.role} / ${mail.label.category}`:mail.proposal?` · 제안·미확정: ${mail.proposal.role} / ${mail.proposal.category}`:' · 분류 없음';
        if(mail.handling)hint.textContent+=` · ${mail.handling.case_id} · 사용자 기준: ${mail.handling.category??'등록 여부 확인'} · ${mail.handling.reason}${mail.handling.reply_note?' · '+mail.handling.reply_note:''}`;
        if(mail.work_review)hint.textContent+=` · 처리 상태: ${mail.work_review.status} · ${mail.work_review.next_action}`;
        li.append(button,hint);el('outlook-list').append(li);
      }
      if(!data.mails.length)el('outlook-list').textContent='이 페이지에 수집 메일이 없습니다.';
      el('outlook-prev').disabled=offset===0;el('outlook-next').disabled=!data.hasMore;
    }catch(error){if(active===epoch)report(error);}
  }
  async function inquiries(){
    const active=epoch,data=await api('/api/inquiries?offset='+inquiryOffset);if(active!==epoch)return;
    el('outlook-inquiry').replaceChildren(option('','기존 문의 선택'),...data.inquiries.filter(i=>i.status!=='closed').map(i=>option(i.id,i.title)));
    el('outlook-inquiry-prev').disabled=inquiryOffset===0;el('outlook-inquiry-next').disabled=!data.hasMore;
  }
  async function review(id){
    clearReview();const active=epoch,sequence=reviewSequence;
    try{
      const {mail}=await api('/api/outlook/'+id);if(active!==epoch||sequence!==reviewSequence)return;
      selected=mail;registrationId=crypto.randomUUID();
      const p=mail.proposal,l=mail.label;
      el('outlook-proposal').textContent=p?`분류 제안·미확정: ${p.role} / ${p.category} · 신호 ${p.confidence}${p.customer_ref?' · 참조 고객: '+p.customer_ref:''}. ${(p.evidence??[]).join(' · ')}`:'분류 제안이 없습니다.';
      el('outlook-label').textContent=l?`사용자 확정: ${l.role} / ${l.category} · 검토 버전 ${l.revision}`:'사용자가 확정한 분류가 없습니다.';
      el('outlook-role').value=l?.role??'';el('outlook-category').value=l?.category??'';
      const handling=listedHandling.get(id);
      if(handling){
        el('outlook-label').textContent=`${handling.case_id} · 이번 사용자 확인 기준: ${handling.category??'등록 여부 확인'} · ${handling.reason}${handling.reply_note?' · '+handling.reply_note:''}. 기존 DB 분류는 아직 변경하지 않았습니다.`;
        el('outlook-proposal').textContent=p?`기존 저장 제안: ${p.role} / ${p.category}`:'기존 저장 제안이 없습니다.';
        el('outlook-role').value=handling.role??l?.role??'';el('outlook-category').value=handling.category??l?.category??'';
      }
      el('outlook-review').hidden=false;el('outlook-subject').textContent=mail.subject||'(제목 없음)';
      if(mail.work_review){const w=mail.work_review;el('outlook-workflow-preview').textContent=`처리 상태: ${w.status}\n확인 근거: ${w.evidence}\n다음 할 일: ${w.next_action}\n기한/일정: ${w.schedule}\n확인 기준: ${w.basis}\n${w.limitation}`;}
      el('outlook-review').scrollIntoView?.({block:'start',behavior:'smooth'});
      el('outlook-meta').textContent=`${mail.original.sender} → ${mail.original.recipients} · ${seoul(mail.occurred_at)} · 첨부 메타데이터 ${mail.original.attachments.length}개`;
      el('outlook-body').textContent=mail.state==='held'?`본문 ${mail.body_length.toLocaleString()}자. 본문 전체는 이 PC의 승인된 Outlook sources/outbox.sqlite에 보존되어 있으며 서버로 보내지 않았습니다. 문의 연결은 보류합니다.`:mail.original.body;
      el('outlook-link-form').hidden=mail.state!=='pending'||mail.excluded||handling?.include===false;el('outlook-linked-open').hidden=mail.state!=='linked';
      el('outlook-link-save').disabled=false;
      el('outlook-triage').hidden=mail.state==='linked';el('outlook-triage').disabled=false;el('outlook-triage').textContent=mail.excluded?'업무 목록으로 복원':'업무 제외';
      el('outlook-triage-note').textContent=mail.state==='linked'?'문의에 연결한 메일은 업무에서 제외할 수 없습니다.':mail.excluded?'업무에서 제외한 메일입니다. 문의에 연결하려면 먼저 복원하세요. 원문과 영수증은 보존되어 있습니다.':'업무에서 제외해도 원문과 영수증은 보존합니다. 긴 본문 보류 여부는 바뀌지 않습니다.';
      el('outlook-new-title').value=mail.subject.slice(0,300);
      if(mail.state==='pending'&&!mail.excluded&&handling?.include!==false){
        const lookups=await api('/api/lookups');if(active!==epoch||sequence!==reviewSequence)return;
        if(lookups.truncated)throw new Error('고객 목록 범위 확장이 필요합니다.');
        el('outlook-customer').replaceChildren(option('','신규 고객사 입력'),...lookups.customers.map(c=>option(c.id,c.name)));
        inquiryOffset=0;await inquiries();
      }
    }catch(error){if(active===epoch)report(error);}
  }
  el('nav-outlook').addEventListener('click',()=>{show('outlook');status();list();});
  el('mobile-outlook').addEventListener('click',()=>{show('outlook');status();list();});
  el('outlook-start').addEventListener('click',async()=>{
    const active=epoch;el('outlook-start').disabled=true;
    try{await api('/api/outlook/local','POST',{});if(active===epoch){message('outlook-message','직접 시작한 수집 작업입니다. 완료 후 목록을 재조회하세요.');await status();}}
    catch(error){if(active===epoch){report(error);el('outlook-start').disabled=false;}}
  });
  el('outlook-reload').addEventListener('click',()=>{status();list();});
  el('outlook-workflow').addEventListener('click',async()=>{
    const mail=selected,active=epoch,sequence=reviewSequence;if(!mail||el('outlook-workflow').disabled)return;
    el('outlook-workflow').disabled=true;el('outlook-workflow-preview').textContent='업무 단계 검토 중…';
    try{
      const {workflow:w}=await api('/api/outlook/'+mail.id+'/workflow');
      if(active!==epoch||sequence!==reviewSequence||selected?.id!==mail.id)return;
      el('outlook-workflow-preview').textContent=`업무 검토 제안·미확정: ${w.work_kind} / ${w.stage}\n대기 대상: ${w.waiting_on}\n다음 할 일: ${w.next_action}\n수집 범위의 동일 대화 ${w.thread_count}건 · 이후 발송 ${w.later_sent}건 · 이후 수신 ${w.later_received}건 · 기록 비교 시각 ${seoul(w.observed_at)}\n근거: ${(w.evidence??[]).join(' · ')||'추가 검토 필요'}\n${(w.caveats??[]).join('\n')}\n검토 후 아래 문의 연결 또는 연결된 문의의 Action 등록에서 직접 저장하세요.`;
    }catch(error){if(active===epoch&&sequence===reviewSequence){el('outlook-workflow-preview').textContent='업무 검토 결과를 확인하지 못했습니다. 원문을 유지했습니다. 다시 시도하거나 직접 검토하세요.';report(error);}}
    finally{if(active===epoch&&sequence===reviewSequence)el('outlook-workflow').disabled=false;}
  });
  el('outlook-review-sync').addEventListener('click',async()=>{
    const active=epoch;el('outlook-review-sync').disabled=true;
    try{await api('/api/outlook/review-sync','POST',{});if(active===epoch){message('outlook-message','오늘 검토본과 분류 제안을 연결합니다. 완료 후 목록을 재조회하세요. 사용자 확정과 원문은 보존합니다.');await status();}}
    catch(error){if(active===epoch){report(error);el('outlook-review-sync').disabled=false;}}
  });
  for(const [id,set] of [['outlook-category-filter',v=>category=v],['outlook-classification-filter',v=>classification=v]])el(id).addEventListener('change',()=>{set(el(id).value);offset=0;clearReview();list();});
  el('outlook-classify').addEventListener('click',async()=>{
    const mail=selected,active=epoch,sequence=reviewSequence;if(!mail||el('outlook-classify').disabled)return;
    const role=el('outlook-role').value,category=el('outlook-category').value;
    if(!classificationRoles.includes(role)||!businessCategories.includes(category)){report(new Error('상대 관계와 고객 업무 또는 HQ 업무를 선택해주세요.'));return;}
    const revision=mail.classification_revision??0;
    if(!labelRequest||labelRequest.role!==role||labelRequest.category!==category||labelRequest.revision!==revision)labelRequest={id:crypto.randomUUID(),revision,role,category};
    classificationControls(true);
    try{
      await api('/api/outlook/'+mail.id+'/classification','POST',labelRequest);
      if(active!==epoch||sequence!==reviewSequence||selected?.id!==mail.id)return;
      await review(mail.id);
      if(active!==epoch||sequence+1!==reviewSequence||selected?.id!==mail.id)return;
      await list();if(active===epoch&&sequence+1===reviewSequence)message('outlook-message','분류를 저장하고 최신 확정을 재조회했습니다. 문의 연결·업무 제외는 그대로입니다.');
    }catch(error){if(active===epoch&&sequence===reviewSequence)report(error);}
    finally{if(active===epoch&&sequence===reviewSequence)classificationControls(false);}
  });
  el('outlook-filter').addEventListener('change',()=>{view=el('outlook-filter').value;offset=0;clearReview();list();});
  el('outlook-triage').addEventListener('click',async()=>{
    const mail=selected,active=epoch,sequence=reviewSequence;if(!mail||mail.state==='linked')return;
    el('outlook-triage').disabled=true;
    try{
      await api('/api/outlook/'+mail.id+'/triage','POST',{excluded:!mail.excluded,revision:mail.triage_revision});
      if(active!==epoch||sequence!==reviewSequence||selected?.id!==mail.id)return;
      clearReview();await list();if(active===epoch)message('outlook-message',mail.excluded?'업무 목록으로 복원했습니다. 원문과 영수증은 유지했습니다.':'업무에서 제외했습니다. 원문과 영수증은 유지했으며 업무 제외 목록에서 복원할 수 있습니다.');
    }catch(error){if(active===epoch&&sequence===reviewSequence)report(error);}
    finally{if(active===epoch&&sequence===reviewSequence)el('outlook-triage').disabled=false;}
  });
  for(const [name,delta] of [['prev',-50],['next',50]])el('outlook-'+name).addEventListener('click',()=>{offset=Math.max(0,offset+delta);list();});
  for(const [name,delta] of [['prev',-100],['next',100]])el('outlook-inquiry-'+name).addEventListener('click',()=>{inquiryOffset=Math.max(0,inquiryOffset+delta);inquiries().catch(report);});
  el('outlook-linked-open').addEventListener('click',()=>{if(selected?.inquiry_id)open(selected.inquiry_id);});
  el('outlook-link-form').addEventListener('submit',async event=>{
    event.preventDefault();const mail=selected,active=epoch,sequence=reviewSequence;if(!mail||mail.state!=='pending'||mail.excluded)return;
    const button=el('outlook-link-save');button.disabled=true;
    try{
      const mode=el('outlook-link-mode').value;
      const payload=mode==='existing'?{inquiry_id:el('outlook-inquiry').value}:{registration:{id:registrationId,customer_id:el('outlook-customer').value||null,customer_name:el('outlook-customer').value?'':el('outlook-customer-name').value,title:el('outlook-new-title').value,channel:'email',received_at:mail.occurred_at,original_text:mail.original.body,next_action:''}};
      const data=await api('/api/outlook/'+mail.id+'/link','POST',payload);if(active!==epoch||sequence!==reviewSequence||selected?.id!==mail.id)return;
      message('outlook-message','메일 원문을 보존해 문의에 연결했습니다. 발송 기록이나 문의 상태는 자동 변경하지 않았습니다.');
      await review(mail.id);if(active!==epoch||reviewSequence!==sequence+1||selected?.id!==mail.id)return;
      await list();if(active!==epoch||reviewSequence!==sequence+1||selected?.id!==mail.id)return;
      await open(data.result);
    }catch(error){if(active===epoch&&sequence===reviewSequence)report(error);}
    finally{if(active===epoch&&sequence===reviewSequence)button.disabled=false;}
  });
  return {reviewMail(id){return review(id);},async bind(id,page=0){
    const active=epoch;el('detail-mails').replaceChildren();
    try{
      const data=await api('/api/outlook?inquiry_id='+id+'&offset='+page);if(active!==epoch)return;
      for(const mail of data.mails){const button=document.createElement('button');button.textContent=`${seoul(mail.occurred_at)} · ${mail.subject||'(제목 없음)'}`;button.addEventListener('click',()=>{show('outlook');review(mail.id);});el('detail-mails').append(button,document.createElement('br'));}
      if(!data.mails.length)el('detail-mails').textContent='연결한 Outlook 메일이 없습니다.';
      for(const [label,target] of [['이전 연결 메일',page-50],['다음 연결 메일',page+50]])if(target>=0&&(target<page||data.hasMore)){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',()=>this.bind(id,target));el('detail-mails').append(b);}
    }catch(error){if(active===epoch)el('detail-mails').textContent=error.message;}
  },reset(){epoch++;listSequence++;clearTimeout(timer);clearReview();listedHandling.clear();if(el('outlook-handling-summary'))el('outlook-handling-summary').textContent='';offset=0;view='active';category=classification='all';el('outlook-category-filter').value='all';el('outlook-classification-filter').value='all';el('outlook-review-sync').disabled=false;el('outlook-filter').value=view;el('detail-mails').replaceChildren();el('outlook-list').replaceChildren();el('outlook-status').textContent='';message('outlook-message','');}};
}

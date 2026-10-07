const el=id=>document.getElementById(id);
const seoul=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export function initOutlook({api,message,show,open}){
  let epoch=0,offset=0,view='active',selected=null,registrationId=crypto.randomUUID(),timer=null,inquiryOffset=0,reviewSequence=0,listSequence=0;
  const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
  const report=error=>message('outlook-message',error.message,true);
  function clearReview(){reviewSequence++;selected=null;el('outlook-review').hidden=true;for(const name of ['body','meta','subject','triage-note'])el('outlook-'+name).textContent='';el('outlook-link-form').hidden=true;el('outlook-linked-open').hidden=true;el('outlook-triage').hidden=true;}
  async function status(){
    clearTimeout(timer);
    const active=epoch;
    try{
      const data=await api('/api/outlook/local');if(active!==epoch)return;
      const period=data.window_start?`${seoul(data.window_start)} 이상 ~ ${seoul(data.window_end)} 미만 (서울)`:'승인된 최근 1개월 스냅샷';
      el('outlook-status').textContent=`${period} · 로컬 ${data.total??'—'}건 · 서버 영수증 ${data.receipted??'—'}건 · 미전송 ${data.pending??'—'}건 · 긴 본문 보류 ${data.held??'—'}건. ${data.running?'수집·전송 중':data.error||data.last_error?'오류: '+(data.error||data.last_error):'대기'}. 마지막 서버 성공: ${data.last_success_at?seoul(data.last_success_at):'없음'}`;
      el('outlook-start').disabled=Boolean(data.running);
      if(data.running)timer=setTimeout(status,2500);
    }catch(error){if(active===epoch)report(error);}
  }
  async function list(){
    const active=epoch,sequence=++listSequence;
    try{
      const data=await api('/api/outlook?offset='+offset+'&view='+view);if(active!==epoch||sequence!==listSequence)return;
      el('outlook-list').replaceChildren();
      for(const mail of data.mails){
        const li=document.createElement('li'),button=document.createElement('button'),hint=document.createElement('small');
        button.textContent=mail.subject||'(제목 없음)';button.addEventListener('click',()=>review(mail.id));
        hint.textContent=`${mail.direction==='sent'?'보낸':'받은'} · ${seoul(mail.occurred_at)} · ${mail.excluded?'업무 제외 · ':''}${mail.state==='held'?'보류: 긴 본문 로컬 원문 보존':mail.state==='linked'?'문의 연결됨':'검토 대기'}`;
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
      el('outlook-review').hidden=false;el('outlook-subject').textContent=mail.subject||'(제목 없음)';
      el('outlook-meta').textContent=`${mail.original.sender} → ${mail.original.recipients} · ${seoul(mail.occurred_at)} · 첨부 메타데이터 ${mail.original.attachments.length}개`;
      el('outlook-body').textContent=mail.state==='held'?`본문 ${mail.body_length.toLocaleString()}자. 본문 전체는 이 PC의 승인된 Outlook sources/outbox.sqlite에 보존되어 있으며 서버로 보내지 않았습니다. 문의 연결은 보류합니다.`:mail.original.body;
      el('outlook-link-form').hidden=mail.state!=='pending'||mail.excluded;el('outlook-linked-open').hidden=mail.state!=='linked';
      el('outlook-link-save').disabled=false;
      el('outlook-triage').hidden=mail.state==='linked';el('outlook-triage').disabled=false;el('outlook-triage').textContent=mail.excluded?'업무 목록으로 복원':'업무 제외';
      el('outlook-triage-note').textContent=mail.state==='linked'?'문의에 연결한 메일은 업무에서 제외할 수 없습니다.':mail.excluded?'업무에서 제외한 메일입니다. 문의에 연결하려면 먼저 복원하세요. 원문과 영수증은 보존되어 있습니다.':'업무에서 제외해도 원문과 영수증은 보존합니다. 긴 본문 보류 여부는 바뀌지 않습니다.';
      el('outlook-new-title').value=mail.subject.slice(0,300);
      if(mail.state==='pending'&&!mail.excluded){
        const lookups=await api('/api/lookups');if(active!==epoch||sequence!==reviewSequence)return;
        if(lookups.truncated)throw new Error('고객 목록 범위 확장이 필요합니다.');
        el('outlook-customer').replaceChildren(option('','신규 고객사 입력'),...lookups.customers.map(c=>option(c.id,c.name)));
        inquiryOffset=0;await inquiries();
      }
    }catch(error){if(active===epoch)report(error);}
  }
  el('nav-outlook').addEventListener('click',()=>{show('outlook');status();list();});
  el('outlook-start').addEventListener('click',async()=>{
    const active=epoch;el('outlook-start').disabled=true;
    try{await api('/api/outlook/local','POST',{});if(active===epoch){message('outlook-message','직접 시작한 수집 작업입니다. 완료 후 목록을 재조회하세요.');await status();}}
    catch(error){if(active===epoch){report(error);el('outlook-start').disabled=false;}}
  });
  el('outlook-reload').addEventListener('click',()=>{status();list();});
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
  return {async bind(id,page=0){
    const active=epoch;el('detail-mails').replaceChildren();
    try{
      const data=await api('/api/outlook?inquiry_id='+id+'&offset='+page);if(active!==epoch)return;
      for(const mail of data.mails){const button=document.createElement('button');button.textContent=`${seoul(mail.occurred_at)} · ${mail.subject||'(제목 없음)'}`;button.addEventListener('click',()=>{show('outlook');review(mail.id);});el('detail-mails').append(button,document.createElement('br'));}
      if(!data.mails.length)el('detail-mails').textContent='연결한 Outlook 메일이 없습니다.';
      for(const [label,target] of [['이전 연결 메일',page-50],['다음 연결 메일',page+50]])if(target>=0&&(target<page||data.hasMore)){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',()=>this.bind(id,target));el('detail-mails').append(b);}
    }catch(error){if(active===epoch)el('detail-mails').textContent=error.message;}
  },reset(){epoch++;listSequence++;clearTimeout(timer);clearReview();offset=0;view='active';el('outlook-filter').value=view;el('detail-mails').replaceChildren();el('outlook-list').replaceChildren();el('outlook-status').textContent='';message('outlook-message','');}};
}

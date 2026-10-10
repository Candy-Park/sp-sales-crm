export function initThreadReview({root,api,isConnected,open,prepare}){
 let epoch=0;
 const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const title=make('h2','메일 대조 · 할 일 제안'),hint=make('p','기존 받은·보낸 대화를 비교합니다. 제안은 저장된 상태와 구분하며, 작성 버튼은 저장 전 확인 화면을 엽니다.');
 const status=make('p','CRM 계정 연결 후 대조 결과를 표시합니다.'),reload=make('button','업무 대조 다시 보기'),list=document.createElement('div');reload.type='button';reload.className='btn btn-outline-secondary btn-sm';reload.disabled=true;root.append(title,hint,status,reload,list);
 const date=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
 async function load(){
  if(!isConnected())return;const active=++epoch;reload.disabled=true;status.textContent='기존 대화와 저장된 할 일을 대조하고 있습니다.';
  try{
   const data=await api('/api/followups?view=analysis');if(active!==epoch||!isConnected())return;list.replaceChildren();
   for(const t of data.threads){
    const card=document.createElement('details');card.className='task-mail-details';card.append(make('summary',`${t.current.title} · 받은 ${t.received} / 보낸 ${t.sent}`));
    card.append(make('p',`저장 상태: ${t.current.status==='closed'?'종료':'진행 중'} · 현재 다음 행동: ${t.current.next_action||'미등록'}`));
    const actions=document.createElement('ul');for(const a of t.current.actions){actions.append(make('li',`${a.status==='open'?'미완료':a.status==='completed'?'완료':a.status} · ${a.description}${a.due_date?' · '+a.due_date:''}`));}card.append(actions);
    card.append(make('h3',t.confirmed_review?'확정한 할 일 유지':'대조 제안'),make('p',t.proposal.next_action),make('p','메일 기록만으로 고객 수령·질문 해결·업무 완료를 확정하지 않습니다.'));
    const button=make('button','저장된 업무 열기');button.type='button';button.addEventListener('click',()=>open(t.inquiry_id));card.append(button);
    if(t.current.status!=='closed'&&!t.confirmed_review){
     const draft=make('button','제안으로 할 일 작성');draft.type='button';draft.addEventListener('click',async()=>{
      draft.disabled=true;try{const okay=await prepare(t.inquiry_id,t.proposal.next_action);if(active===epoch&&!okay)status.textContent='업무를 다시 조회한 뒤 작성하세요.';}catch(error){if(active===epoch)status.textContent=error.message;}finally{draft.disabled=false;}
     });card.append(draft);
    }
    card.append(make('h3','메일 흐름 · 최신 본문 발췌'));
    for(const m of t.timeline){
     const item=document.createElement('details');item.append(make('summary',`${date(m.occurred_at)} · ${m.direction==='sent'?'보낸 메일':'받은 메일'}`));
     item.append(make('pre',m.held?'긴 본문 또는 인증정보 가능성이 있어 내용을 표시하지 않습니다.':m.excerpt||'표시할 최신 본문이 없습니다.'));
     if(m.truncated)item.append(make('p','본문 일부만 표시했습니다. 전체 내용은 Outlook에서 확인하세요.'));card.append(item);
    }
    if(t.omitted)card.append(make('p',`이전 메일 ${t.omitted}통은 표시 범위에서 생략했습니다.`));list.append(card);
   }
   status.textContent=`${data.threads.length}개 업무 대조 완료 · 원문·확정 상태 유지 · 자동 저장 없음`;
  }catch(error){if(active===epoch){list.replaceChildren();status.textContent=error.message;}}
  finally{if(active===epoch)reload.disabled=!isConnected();}
 }
 reload.addEventListener('click',()=>void load());
 return {start(){void load();},stop(){epoch++;list.replaceChildren();reload.disabled=true;status.textContent='CRM 계정 연결 후 대조 결과를 표시합니다.';}};
}

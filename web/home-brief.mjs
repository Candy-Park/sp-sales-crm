// Home brief: a morning-brief style home with ordered priorities, waiting work and explicit unknowns.
// Rules use saved Actions and mail observations only. Nothing here saves, completes or sends.
const DAY=86400000;
const KIND={customer_reply:'고객 회신',hq_inquiry:'HQ 문의',hq_followup:'HQ 후속 확인',customer_followup:'고객 후속 확인',other:'기타 업무'};
const gap=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/DAY);
const active=groups=>['action','decision','waiting'].flatMap(key=>groups[key]||[]);
export const seoulToday=(now=new Date())=>new Date(+now+9*3600000).toISOString().slice(0,10);
const timeLabel=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));

export function priorityItems(groups,{today,pending=[],limit=5}={}){
 const items=[];
 for(const key of ['action','decision','waiting'])for(const row of groups[key]||[]){
  const title=row.review?.task_title||row.title||'저장된 업무';
  for(const a of row.actions||[]){
   const due=a.due_date;let rank,reason;
   if(due&&due<today){rank=0;reason=`기한 ${gap(due,today)}일 지남`;}
   else if(due===today){rank=1;reason='오늘 기한';}
   else if(key!=='waiting'&&due&&gap(today,due)<=3){rank=3;reason=`${gap(today,due)}일 뒤 기한`;}
   else continue;
   if(key==='waiting')reason+=' · 대기 중 후속 확인';
   if(KIND[a.kind])reason+=' · '+KIND[a.kind];
   items.push({key:'a:'+a.id,id:row.id,title,text:a.description||'내용 확인 필요',reason,due,rank,source:'fact'});
  }
  const next=row.thread?.observation?.next_action;
  if(key==='decision'&&next)items.push({key:'d:'+row.id,id:row.id,title,text:next,reason:'새 메일 도착 · 판단 필요',due:'',rank:2,source:'suggest'});
 }
 for(const p of pending)items.push({key:'p:'+p.source_key,id:null,title:p.subject,text:p.next_action||'요청 내용 확인',reason:p.automatic_registration?'새 담당 요청 · 다음 메일 확인에서 자동 등록':'새 담당 요청 · 연결할 고객 선택 필요',due:'',rank:2,source:'suggest'});
 items.sort((x,y)=>x.rank-y.rank||(x.due||'9999').localeCompare(y.due||'9999')||x.key.localeCompare(y.key));
 return {items:items.slice(0,limit),more:Math.max(0,items.length-limit)};
}

export function uncertainItems({groups,dashboard={},follow}){
 const rows=active(groups),list=[];
 if(dashboard.truncated)list.push('저장 업무는 최근 100건만 확인했습니다. 나머지는 문의 조회에서 확인하세요.');
 const noDue=rows.flatMap(r=>r.actions||[]).filter(a=>!a.due_date).length;
 if(noDue)list.push(`기한이 없는 할 일 ${noDue}건 — 기한 확인 필요`);
 const noOwner=rows.filter(r=>!r.review?.task_owner&&!(r.actions||[]).some(a=>a.waiting_target)).length;
 if(noOwner)list.push(`담당자가 확인되지 않은 업무 ${noOwner}건`);
 const noAction=rows.filter(r=>!(r.actions||[]).length&&!r.thread?.observation?.next_action).length;
 if(noAction)list.push(`할 일이 저장되지 않은 업무 ${noAction}건 — 다음 행동 확인 필요`);
 const held=rows.flatMap(r=>r.thread?.timeline||[]).filter(m=>m.held).length;
 if(held)list.push(`표시를 보류한 메일 ${held}통 — 원문 확인 필요`);
 if(follow?.error)list.push('메일 확인 오류 — '+follow.error);
 else if(follow?.remote&&!follow.agent_online)list.push(follow.last_synced_at?`수집 PC 미연결 — 마지막 동기화(${timeLabel(follow.last_synced_at)}) 이후 새 메일은 확인하지 못했습니다.`:'수집 PC 미연결 — 아직 동기화 기록이 없어 새 메일은 확인하지 못했습니다.');
 else if(follow?.skipped==='outlook_not_running')list.push('Outlook이 꺼져 있어 이번 메일 확인을 건너뛰었습니다.');
 return list;
}

export function waitingItems(groups){
 return (groups.waiting||[]).map(row=>{
  const due=(row.actions||[]).map(a=>a.due_date).filter(Boolean).sort()[0]||'';
  const who=(row.actions||[]).find(a=>a.waiting_target)?.waiting_target||'';
  return {id:row.id,title:row.review?.task_title||row.title||'저장된 업무',who,due,next:row.thread?.observation?.next_action||row.next_action||''};
 }).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
}

export function homeCounts(groups,{today,pending=[]}){
 const open=active(groups).flatMap(r=>r.actions||[]),{items,more}=priorityItems(groups,{today,pending});
 return {first:items.length+more,overdue:open.filter(a=>a.due_date&&a.due_date<today).length,dueToday:open.filter(a=>a.due_date===today).length,waiting:(groups.waiting||[]).length};
}

const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
export function badge(source){return make('span',source==='fact'?'확인':'제안','brief-badge brief-badge--'+(source==='fact'?'fact':'suggest'));}
export function withBadge(node,source){if(typeof node.prepend==='function')node.prepend(badge(source));return node;}
const head=(num,title)=>{const node=make('div','','brief-head'),h=make('h2','','brief-title'),meta=make('span','','brief-meta');h.append(make('span',num,'brief-num'),make('span',title));node.append(h,meta);return {node,meta};};
const dateLabel=day=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date(day+'T03:00:00Z'));
const openButton=(id,open)=>{const b=make('button','업무 열기','btn btn-outline-secondary btn-sm');b.type='button';b.addEventListener('click',()=>open(id));return b;};

export function initHomeBrief({priorityRoot,checkRoot,waitingRoot,heroRoot,open,onMain=()=>{},today=()=>seoulToday()}){
 const pList=make('ol','','priority-list'),pNote=make('p','','section-hint'),cList=make('ul','','check-list'),wList=make('ul','','waiting-list');
 const pHead=head('01','우선할 일'),wHead=head('02','답변 기다리는 중'),cHead=head('03','확인 필요');
 priorityRoot.append(pHead.node,make('p','기한·대기·새 메일 기준으로 먼저 할 순서입니다.','section-hint'),pList,pNote);
 waitingRoot?.append(wHead.node,make('p','상대 답변이나 처리를 기다리는 업무입니다. 후속 확인 날짜가 오면 우선할 일에도 나옵니다.','section-hint'),wList);
 checkRoot.append(cHead.node,make('p','이번 조회에서 확인하지 못했거나 비어 있는 정보입니다. 없다고 단정하지 마세요.','section-hint'),cList);
 let hero=null;
 if(heroRoot){
  const main=make('div','','home-hero-main'),side=make('div','','home-hero-side');
  const pill=make('span','','home-pill'),title=make('p','','home-hero-title'),sub=make('p','','home-hero-sub');
  const button=make('button','지금 메일 확인  ↗','btn home-main-action');button.type='button';button.addEventListener('click',()=>onMain());
  main.append(pill,title,sub,button,make('p','메일을 보내거나 업무를 완료 처리하지 않습니다.','home-hero-note'));
  const steps=make('ol','','home-steps'),counts={};
  for(const [num,label,hint,target] of [['01','우선할 일','기한과 새 메일 기준',priorityRoot],['02','답변 기다리는 중','상대 답변·처리 대기',waitingRoot],['03','확인 필요','확인하지 못한 정보',checkRoot]]){
   const li=make('li'),b=make('button','','home-step'),text=make('span','','home-step-text');b.type='button';
   text.append(make('strong',label),make('small',hint));counts[num]=make('span','—','home-step-count');
   b.append(make('span',num,'home-step-num'),text,counts[num]);
   b.addEventListener('click',()=>target?.scrollIntoView?.({behavior:'smooth',block:'start'}));li.append(b);steps.append(li);
  }
  side.append(make('p','오늘 확인할 순서','home-side-label'),steps,make('p','확인 = 저장된 할 일 · 제안 = 메일을 보고 고른 제안','home-hero-foot'));
  heroRoot.append(main,side);hero={pill,title,sub,counts};
 }
 let last=null,follow,failure='';
 const pendingOf=()=>(last?.analysis?.candidates||[]).filter(c=>!c.inquiry_id);
 const setTitle=lines=>hero.title.replaceChildren(...lines.map((line,n)=>make('span',line,n?'home-hero-em':'home-hero-line')));
 function checkItems(){
  const items=[...(failure?['업무 조회 실패 — '+failure]:[]),...(last?uncertainItems({groups:last.groups,dashboard:last.dashboard,follow}):[])];
  if(!last&&!failure)items.push('아직 업무를 조회하지 않았습니다.');
  return items;
 }
 function renderChecks(){
  cList.replaceChildren();const items=checkItems();
  for(const text of items)cList.append(make('li',text));
  if(!items.length)cList.append(make('li','표시할 확인 필요 항목이 없습니다.','empty'));
  cHead.meta.textContent=items.length?items.length+'건':'';if(hero)hero.counts['03'].textContent=String(items.length);
 }
 function renderHero(){
  if(!hero)return;hero.pill.textContent=dateLabel(today());
  if(failure){setTitle(['업무를','불러오지 못했습니다']);hero.sub.textContent='0건이 아니라 확인되지 않은 상태입니다. 아래 확인 필요를 보세요.';hero.counts['01'].textContent='?';hero.counts['02'].textContent='?';return;}
  if(!last){setTitle(['CRM을 연결하면','오늘 할 일을 정리합니다']);hero.sub.textContent='저장된 업무와 메일 변화를 기한 순서로 보여 줍니다.';hero.counts['01'].textContent='—';hero.counts['02'].textContent='—';return;}
  const c=homeCounts(last.groups,{today:today(),pending:pendingOf()});
  setTitle(c.first?['먼저 할 일',c.first+'건']:['지금 급한 일은','없습니다']);
  hero.sub.textContent=`기한 지남 ${c.overdue}건 · 오늘 기한 ${c.dueToday}건 · 답변 대기 ${c.waiting}건`;
  hero.counts['01'].textContent=String(c.first);hero.counts['02'].textContent=String(c.waiting);
 }
 function renderWaiting(){
  if(!waitingRoot)return;wList.replaceChildren();wHead.meta.textContent='';
  if(failure||!last){wList.append(make('li',failure?'업무를 불러오지 못했습니다.':'CRM 연결 후 표시합니다.','empty'));return;}
  const items=waitingItems(last.groups);wHead.meta.textContent=items.length+'건';
  if(!items.length)wList.append(make('li','기다리는 업무가 없습니다.','empty'));
  for(const item of items){
   const li=make('li','','waiting-item'),body=make('div','','priority-body');
   body.append(make('strong',item.title),make('p',[item.who?'대기: '+item.who:'대기 대상 확인 필요',item.due?'후속 확인 '+item.due:'후속 확인 날짜 미지정'].join(' · '),'priority-reason'));
   if(item.next)body.append(make('small',item.next));
   li.append(body,openButton(item.id,open));wList.append(li);
  }
 }
 function renderPriorities(){
  pList.replaceChildren();pNote.textContent='';pHead.meta.textContent='';
  if(failure){pList.append(make('li','업무를 불러오지 못했습니다. 0건이 아니라 확인되지 않은 상태입니다.','empty'));return;}
  if(!last){pList.append(make('li','CRM 연결 후 우선할 일을 정리합니다.','empty'));return;}
  const {items,more}=priorityItems(last.groups,{today:today(),pending:pendingOf()});pHead.meta.textContent=(items.length+more)+'건';
  if(!items.length)pList.append(make('li','기한 지남·오늘·3일 안 기한인 할 일과 새로 판단할 메일이 없습니다.','empty'));
  for(const item of items){
   const li=make('li','','priority-item'),body=make('div','','priority-body');
   body.append(withBadge(make('strong',item.text),item.source),make('p','이유: '+item.reason,'priority-reason'),make('small',item.title));
   li.append(body);if(item.id)li.append(openButton(item.id,open));pList.append(li);
  }
  if(more)pNote.textContent=`그 밖의 할 일 ${more}건은 아래 '전체 업무'에서 확인하세요.`;
 }
 const render=()=>{renderPriorities();renderWaiting();renderChecks();renderHero();};
 render();
 return {
  update(data){last=data;failure='';render();},
  setFollow(data){follow=data;renderChecks();},
  fail(message){last=null;failure=message||'알 수 없는 오류';render();},
  reset(){last=null;follow=undefined;failure='';render();}
 };
}

// Lays out the home like a morning brief: one hero card, three numbered cards, the rest folded.
export function mountHomeBrief({view,open,onMain,agendaRoot,memoAgendaRoot,memoQuick,followRoot,reviewRoot}){
 const section=(id,cls)=>{const n=make('section','',cls);n.id=id;return n;};
 const heroRoot=section('home-hero','home-hero'),priorityRoot=section('home-priorities','brief-card'),waitingRoot=section('home-waiting','brief-card'),checkRoot=section('home-checks','brief-card');
 const label=make('div','','home-today-label'),time=make('span','','home-today-time');label.append(make('h2','나의 오늘'),time);
 const more=make('details','','brief-card home-more');more.append(make('summary','전체 업무 펼치기 · 내가 할 일 · 판단 필요 · 대기 · 종료 이력'));if(agendaRoot)more.append(agendaRoot);
 const strip=view.querySelector('.summary-strip');
 strip.after(heroRoot,label,priorityRoot,waitingRoot,checkRoot,...[memoAgendaRoot,more,memoQuick,followRoot,reviewRoot].filter(Boolean));
 strip.hidden=true;
 for(const node of [view.querySelector('#reload-button'),view.querySelector('.home-lead')])if(node)node.hidden=true;
 view.classList.add('home-brief-view');
 const brief=initHomeBrief({priorityRoot,checkRoot,waitingRoot,heroRoot,open,onMain});
 const stamp=()=>{time.textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date())+' 기준';};
 return {...brief,update(data){stamp();brief.update(data);}};
}

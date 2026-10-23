// Home brief: "오늘 할 일" home with short todo lines, waiting work and explicit unknowns.
// Rules use saved Actions and mail observations only. Nothing here saves, completes or sends.
const DAY=86400000;
const KIND={customer_reply:'고객 회신',hq_inquiry:'HQ 문의',hq_followup:'HQ 후속 확인',customer_followup:'고객 후속 확인',other:'기타 업무'};
const gap=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/DAY);
const active=groups=>['action','decision','waiting'].flatMap(key=>groups[key]||[]);
export const seoulToday=(now=new Date())=>new Date(+now+9*3600000).toISOString().slice(0,10);
const timeLabel=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const monthDay=value=>{const d=new Date(+new Date(value)+9*3600000);return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;};

// First clause of a long saved description, so the line stays readable; the full text stays one click away.
export function shortLine(text,max=56){
 const value=String(text||'').trim();if(!value)return '';
 const clause=value.split(/\s[—–-]\s|(?<=[.。])\s/)[0].trim();
 return clause.length>max?clause.slice(0,max)+'…':clause;
}

export function priorityItems(groups,{today,pending=[],limit=5}={}){
 const items=[];
 for(const key of ['action','decision','waiting'])for(const row of groups[key]||[]){
  const title=row.review?.task_title||row.title||'저장된 업무';
  for(const a of row.actions||[]){
   const due=a.due_date;let rank,reason,chip;
   if(due&&due<today){rank=0;reason=`기한 ${gap(due,today)}일 지남`;chip={label:`${gap(due,today)}일 지남`,tone:'late'};}
   else if(due===today){rank=1;reason='오늘 기한';chip={label:'오늘',tone:'today'};}
   else if(key!=='waiting'&&due&&gap(today,due)<=3){rank=3;reason=`${gap(today,due)}일 뒤 기한`;chip={label:`${gap(today,due)}일 뒤`,tone:'soon'};}
   else if(key!=='waiting'&&!due){rank=4;reason='기한 없음 · 기한 확인 필요';chip={label:'기한 없음',tone:'none'};}
   else continue;
   if(key==='waiting')reason+=' · 대기 중 후속 확인';
   if(KIND[a.kind])reason+=' · '+KIND[a.kind];
   items.push({key:'a:'+a.id,id:row.id,title,text:a.description||'내용 확인 필요',reason,chip,kindLabel:KIND[a.kind]||'',due,rank,source:'fact'});
  }
  const next=row.thread?.observation?.next_action;
  if(key==='decision'&&next)items.push({key:'d:'+row.id,id:row.id,title,text:next,reason:'새 메일 도착 · 판단 필요',chip:{label:'새 메일',tone:'new'},kindLabel:'새 메일 판단',due:'',rank:2,source:'suggest'});
 }
 for(const p of pending)items.push({key:'p:'+p.source_key,id:null,title:p.subject,text:p.next_action||'요청 내용 확인',reason:p.automatic_registration?'새 담당 요청 · 다음 메일 확인에서 자동 등록':'새 담당 요청 · 연결할 고객 선택 필요',chip:{label:'새 요청',tone:'new'},kindLabel:'새 담당 요청',due:'',rank:2,source:'suggest'});
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
  const who=(row.actions||[]).find(a=>a.waiting_target)?.waiting_target||row.review?.task_owner||'';
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
const openButton=(id,open)=>{const b=make('button','열기','btn home-open');b.type='button';b.addEventListener('click',()=>open(id));return b;};

export function initHomeBrief({priorityRoot,checkRoot,waitingRoot,statusRoot,open,onMore=()=>{},today=()=>seoulToday()}){
 const pList=make('ol','','priority-list'),more=make('button','','home-more-link'),cList=make('ul','','check-list'),wList=make('ul','','waiting-list');
 more.type='button';more.addEventListener('click',()=>onMore());
 priorityRoot.append(pList,more);
 waitingRoot?.append(make('h2','답변 기다리는 중','brief-title'),wList);
 checkRoot.append(make('h2','확인 필요','brief-title'),cList);
 let last=null,follow,failure='';
 const pendingOf=()=>(last?.analysis?.candidates||[]).filter(c=>!c.inquiry_id);
 function checkItems(){
  const items=[...(failure?['업무 조회 실패 — '+failure]:[]),...(last?uncertainItems({groups:last.groups,dashboard:last.dashboard,follow}):[])];
  if(!last&&!failure)items.push('아직 업무를 조회하지 않았습니다.');
  return items;
 }
 function renderChecks(){
  cList.replaceChildren();const items=checkItems();
  for(const text of items)cList.append(make('li',text));
  if(!items.length)cList.append(make('li','표시할 확인 필요 항목이 없습니다.','empty'));
 }
 function renderStatus(){
  if(!statusRoot)return;statusRoot.replaceChildren();
  const add=(text,cls)=>statusRoot.append(make('span',text,cls||''));
  if(failure)add('업무를 불러오지 못했습니다 — 0건이 아니라 확인되지 않은 상태','warn');
  else if(!last)add('CRM 연결 후 오늘 할 일을 정리합니다');
  else{const c=homeCounts(last.groups,{today:today(),pending:pendingOf()});add(`기한 지남 ${c.overdue}`,c.overdue?'strong':'');add(`답변 대기 ${c.waiting}`);add(`확인 필요 ${checkItems().length}`);}
  if(follow?.error)add('메일 확인 오류','warn');
  else if(follow?.remote&&!follow.agent_online)add(follow.last_synced_at?`메일 수집 PC 미연결 · 마지막 ${monthDay(follow.last_synced_at)}`:'메일 수집 PC 미연결','warn');
 }
 function renderWaiting(){
  if(!waitingRoot)return;wList.replaceChildren();
  if(failure||!last){wList.append(make('li',failure?'업무를 불러오지 못했습니다.':'CRM 연결 후 표시합니다.','empty'));return;}
  const items=waitingItems(last.groups);
  if(!items.length)wList.append(make('li','기다리는 업무가 없습니다.','empty'));
  for(const item of items){
   const li=make('li','','waiting-item'),body=make('div','','waiting-body');
   body.append(make('strong',item.title),make('small',`${item.who||'대기 대상 확인 필요'} · ${item.due?'후속 확인 '+item.due:'후속 확인일 없음'}`));
   li.append(body,openButton(item.id,open));wList.append(li);
  }
 }
 function renderPriorities(){
  pList.replaceChildren();more.textContent='전체 할 일 보기';
  if(failure){pList.append(make('li','업무를 불러오지 못했습니다. 0건이 아니라 확인되지 않은 상태입니다.','empty'));return;}
  if(!last){pList.append(make('li','CRM 연결 후 오늘 할 일을 정리합니다.','empty'));return;}
  const {items,more:rest}=priorityItems(last.groups,{today:today(),pending:pendingOf(),limit:3});
  if(rest)more.textContent=`전체 할 일 보기 · ${rest}건 더`;
  if(!items.length)pList.append(make('li','기한 지남·오늘·3일 안 기한·기한 없는 할 일과 새로 판단할 메일이 없습니다.','empty'));
  for(const item of items){
   const li=make('li','','priority-item'),main=make('div','','priority-main'),head=make('div','','priority-head');
   head.append(make('strong',item.title,'priority-title'),make('span',item.chip.label,'home-chip home-chip--'+item.chip.tone));
   const line=shortLine(item.text);
   main.append(head,make('p',[item.kindLabel,line].filter(Boolean).join(' · '),'priority-sub'));
   if(line!==item.text.trim()){const d=make('details','','priority-orig');d.append(make('summary','원문 보기'),make('p',item.text));main.append(d);}
   li.append(main);if(item.id)li.append(openButton(item.id,open));pList.append(li);
  }
 }
 const render=()=>{renderPriorities();renderWaiting();renderChecks();renderStatus();};
 render();
 return {
  update(data){last=data;failure='';render();},
  setFollow(data){follow=data;renderChecks();renderStatus();},
  fail(message){last=null;failure=message||'알 수 없는 오류';render();},
  reset(){last=null;follow=undefined;failure='';render();}
 };
}

// Lays out the home: title with one primary button, one status line, top-three todos, waiting and unknowns, the rest folded.
export function mountHomeBrief({view,open,onMain,agendaRoot,memoAgendaRoot,memoQuick,followRoot,reviewRoot}){
 const section=(id,cls)=>{const n=make('section','',cls);n.id=id;return n;};
 const priorityRoot=section('home-priorities','brief-card home-todo'),waitingRoot=section('home-waiting','brief-card'),checkRoot=section('home-checks','brief-card');
 const statusRoot=make('div','','home-status');statusRoot.setAttribute?.('role','status');
 const grid=make('div','','home-grid');grid.append(waitingRoot,checkRoot);
 const agendaFold=make('details','','brief-card home-fold');agendaFold.id='home-all-work';agendaFold.append(make('summary','전체 할 일 · 판단 필요 · 대기 · 종료 이력'));if(agendaRoot)agendaFold.append(agendaRoot);
 const restFold=make('details','','brief-card home-fold');restFold.append(make('summary','메모 · 연결 상태 · 메일 대조 상세'));for(const n of [memoAgendaRoot,memoQuick,followRoot,reviewRoot])if(n)restFold.append(n);
 const title=view.querySelector('.dashboard-title'),main=make('button','지금 메일 확인  ↗','btn home-main-action');main.type='button';main.addEventListener('click',()=>onMain());
 title.append(main);title.after(statusRoot);
 const strip=view.querySelector('.summary-strip');strip.after(priorityRoot,grid,agendaFold,restFold);strip.hidden=true;
 for(const node of [view.querySelector('#reload-button'),view.querySelector('#dashboard-message')])if(node)node.hidden=true;
 view.classList.add('home-brief-view');
 return initHomeBrief({priorityRoot,checkRoot,waitingRoot,statusRoot,open,onMore:()=>{agendaFold.open=true;agendaFold.scrollIntoView?.({behavior:'smooth',block:'start'});}});
}

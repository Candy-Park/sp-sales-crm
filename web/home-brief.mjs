// Home brief: ordered priorities with a one-line reason, and an explicit "확인 필요" list.
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

const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
export function badge(source){return make('span',source==='fact'?'확인':'제안','brief-badge brief-badge--'+(source==='fact'?'fact':'suggest'));}
export function withBadge(node,source){if(typeof node.prepend==='function')node.prepend(badge(source));return node;}

export function initHomeBrief({priorityRoot,checkRoot,open,today=()=>seoulToday()}){
 const pList=make('ol','','priority-list'),pNote=make('p','','section-hint'),cList=make('ul','','check-list');
 priorityRoot.append(make('h2','우선할 일'),make('p','기한·대기·새 메일 기준의 처리 순서입니다. 확인 = 저장된 할 일, 제안 = 메일을 보고 고른 제안입니다.','section-hint'),pList,pNote);
 checkRoot.append(make('h2','확인 필요'),make('p','이번 조회에서 확인하지 못했거나 비어 있는 정보입니다. 없다고 단정하지 마세요.','section-hint'),cList);
 let last=null,follow,failure='';
 function renderChecks(){
  cList.replaceChildren();
  const items=[...(failure?['업무 조회 실패 — '+failure]:[]),...(last?uncertainItems({groups:last.groups,dashboard:last.dashboard,follow}):[])];
  if(!last&&!failure)items.push('아직 업무를 조회하지 않았습니다.');
  for(const text of items)cList.append(make('li',text));
  if(!items.length)cList.append(make('li','표시할 확인 필요 항목이 없습니다.','empty'));
 }
 function renderPriorities(){
  pList.replaceChildren();pNote.textContent='';
  if(failure){pList.append(make('li','업무를 불러오지 못했습니다. 0건이 아니라 확인되지 않은 상태입니다.','empty'));return;}
  if(!last){pList.append(make('li','CRM 연결 후 우선할 일을 정리합니다.','empty'));return;}
  const pending=(last.analysis?.candidates||[]).filter(c=>!c.inquiry_id);
  const {items,more}=priorityItems(last.groups,{today:today(),pending});
  if(!items.length)pList.append(make('li','기한 지남·오늘·3일 안 기한인 할 일과 새로 판단할 메일이 없습니다.','empty'));
  for(const item of items){
   const li=make('li','','priority-item'),body=make('div','','priority-body');
   body.append(withBadge(make('strong',item.text),item.source),make('p','이유: '+item.reason,'priority-reason'),make('small',item.title));
   li.append(body);
   if(item.id){const button=make('button','업무 열기','btn btn-outline-secondary btn-sm');button.type='button';button.addEventListener('click',()=>open(item.id));li.append(button);}
   pList.append(li);
  }
  if(more)pNote.textContent=`그 밖의 할 일 ${more}건은 아래 '오늘의 업무'에서 확인하세요.`;
 }
 const render=()=>{renderPriorities();renderChecks();};
 render();
 return {
  update(data){last=data;failure='';render();},
  setFollow(data){follow=data;renderChecks();},
  fail(message){last=null;failure=message||'알 수 없는 오류';render();},
  reset(){last=null;follow=undefined;failure='';render();}
 };
}

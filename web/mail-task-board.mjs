export function taskGroups(mails){
 const groups={action:[],waiting:[],responded:[],unknown:[]};
 for(const mail of mails){
  if(mail.handling?.include===false)continue;
  const bucket=mail.work_review?.task_bucket;
  groups[Object.hasOwn(groups,bucket)?bucket:'unknown'].push(mail);
 }
 groups.action.sort((a,b)=>(a.work_review?.due_date||'9999').localeCompare(b.work_review?.due_date||'9999'));
 return groups;
}
export function renderTaskBoard(root,mails,onOpen){
 const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
 const groups=taskGroups(mails);root.replaceChildren();
 const counts=node('div',null,'task-counts');
 for(const [key,label] of [['action','내가 할 일'],['waiting','진행 상황'],['responded','회신 완료']])counts.append(node('span',`${label} ${groups[key].length}`));
 root.append(counts);
 for(const [key,title,description] of [['action','내가 할 일','해야 할 행동과 날짜부터 확인하세요.'],['waiting','진행 상황','출하와 고객 수령, 잔여 물량을 구분해 봅니다.'],['responded','회신 완료 · 추가 요청 시 대응','전체 주문 종료와 구분한 회신 완료 항목입니다.'],['unknown','상태 정리 대기','근거가 없는 업무는 완료로 추정하지 않습니다.']]){
  if(key==='unknown'&&!groups[key].length)continue;
  const section=node(key==='responded'?'details':'section',null,`task-section task-${key}`);
  section.append(node(key==='responded'?'summary':'h2',`${title} · ${groups[key].length}`));
  section.append(node('p',description,'section-hint'));
  const list=node('ul',null,'task-cards');
  for(const mail of groups[key]){
   const w=mail.work_review,card=node('li',null,'task-card');
   card.append(node('span',mail.handling?.category||'업무','task-category'));
   card.append(node('h3',w?.task_title||mail.subject||'업무 상태 확인'));
   const meta=node('div',null,'task-meta');
   meta.append(node('strong',w?.task_date_label||'기한 미지정'));
   if(w?.task_owner)meta.append(node('span',w.task_owner));
   card.append(meta,node('p',w?.task_note||'메일 근거를 추가 확인해야 합니다.','task-note'));
   const button=node('button','관련 메일 · 판단 근거 보기','btn btn-outline-secondary');button.type='button';button.addEventListener('click',()=>onOpen(mail.id));card.append(button);list.append(card);
  }
  if(!groups[key].length)list.append(node('li','등록된 항목이 없습니다.','section-hint'));
  section.append(list);root.append(section);
 }
}

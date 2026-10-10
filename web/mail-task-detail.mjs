export function renderTaskDetail(root,mail,onBack,onCRM){
 const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
 const w=mail.work_review??{};root.replaceChildren();
 const back=node('button','← 할 일 목록으로','btn btn-outline-secondary');back.type='button';back.addEventListener('click',onBack);root.append(back);
 const header=node('header',null,'task-detail-heading');header.append(node('span',mail.handling?.category||'업무','task-category'),node('h1',w.task_title||mail.subject||'업무 상세'),node('span',w.status||'상태 확인 필요','task-state-badge'));root.append(header);
 if(onCRM&&mail.handling?.include){const button=node('button','CRM 문의 연결 · 열기','btn btn-primary');button.type='button';button.addEventListener('click',onCRM);root.append(button);}
 const grid=node('div',null,'task-detail-grid'),main=node('div',null,'task-detail-main'),aside=node('aside',null,'task-detail-side');
 const section=(title,text,className='')=>{const card=node('section',null,`task-panel ${className}`);card.append(node('h2',title),node('p',text||'확인되지 않았습니다.'));return card;};
 const next=section('지금 해야 할 일',w.next_action,'task-next-action');
 const metadata=node('div',null,'task-meta');metadata.append(node('strong',w.task_date_label||w.schedule||'기한 미확인'),node('span',w.task_owner||'담당자 확인 필요'));next.append(metadata);main.append(next);
 main.append(section('업무 요약',w.task_note));
 const checks=node('section',null,'task-panel');checks.append(node('h2','확인된 내용과 남은 처리'));const list=node('ul',null,'task-checks');
 for(const check of w.checks??[]){const row=node('li');row.append(node('span',check.label),node('strong',check.state));list.append(row);}
 if(!(w.checks?.length))list.append(node('li','추가 내용 확인이 필요합니다.'));checks.append(list);main.append(checks);
 aside.append(section('메일에서 확인한 근거',w.evidence),section('확인이 더 필요한 부분',w.limitation,'task-caveat'));
 const basis=section('확인 출처',w.basis);if(w.reviewed_on)basis.append(node('small',`마지막 정리 ${w.reviewed_on}`));aside.append(basis);
 grid.append(main,aside);root.append(grid);
 const preparation=node('details',null,'task-panel task-evidence');preparation.append(node('summary','답변 준비 · 자료 확인'));
 preparation.append(node('p','한국어·영어 답변 초안은 아직 작성하지 않았습니다. 아래 메일 자료를 먼저 확인하세요.','section-hint'));
 const attachments=w.supporting_files??mail.original?.attachments??[];const files=node('ul',null,'task-files');
 for(const file of attachments)files.append(node('li',file.name));
 preparation.append(files,node('small',w.supporting_files?'대조한 관련 대화의 첨부 목록입니다. 파일 내용 자체는 이번에 검수하지 않았으며 Outlook에서 확인할 수 있습니다.':'첨부는 선택한 메일의 목록입니다. 후속 대화의 첨부를 모두 모은 목록은 아닙니다.'));root.append(preparation);
 const original=node('details',null,'task-panel task-evidence');original.append(node('summary','관련 메일 원문 보기'),node('h3',mail.subject));
 if(mail.original){original.append(node('p',`${mail.original.sender} → ${mail.original.recipients}`,'section-hint'));original.append(node('pre',mail.state==='held'?'긴 본문은 승인된 로컬 원문에 보존되어 있습니다.':mail.original.body,'original-text'));}
 else original.append(node('p','원문을 불러오지 못했습니다.'));
 root.append(original);
}

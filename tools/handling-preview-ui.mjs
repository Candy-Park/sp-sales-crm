import {initWorkAgenda} from '../web/work-agenda.mjs';
import {initThreadReview} from '../web/mail-thread-review.mjs';
import {initFollowups} from '../web/crm-followups.mjs';
import {initWorkspace} from '../web/workspace.mjs';
import {initCRMConnection} from '../web/crm-connection.mjs';
import {taskGroups} from '../web/mail-task-board.mjs';
import {renderTaskBoard} from '../web/mail-task-board.mjs';
import {renderTaskDetail} from '../web/mail-task-detail.mjs';
import {initMemos} from '../web/local-memos.mjs';
const el=id=>document.getElementById(id);
const message=(id,text,error=false)=>{el(id).textContent=text;el(id).classList.toggle('error',error);};
const api=async(path,method)=>{
 if(method)throw Error('읽기 전용 미리보기입니다.');
 const response=await fetch(path,{cache:'no-store'}),data=await response.json();
 if(!response.ok)throw Error(data.error??'미리보기 데이터를 확인하지 못했습니다.');return data;
};
el('login-view').hidden=true;el('workspace').hidden=false;
el('workspace').classList.add('task-preview');
for(const id of ['dashboard-view','register-view','history-view','detail-view','products-view'])if(el(id))el(id).hidden=true;
el('user-email').textContent='업무 조회 · 메모는 이 PC에 저장';
const view=el('outlook-view'),heading=view.querySelector('h1'),intro=heading.nextElementSibling;
heading.textContent='담당 업무';intro.textContent='할 일과 날짜를 먼저 보고, 필요한 메일만 펼쳐 확인하세요.';
for(const id of ['outlook-start','outlook-review-sync','outlook-status'])el(id).hidden=true;
for(const note of el('outlook-view').querySelectorAll('p'))if(note.textContent.startsWith('오늘 검토본은'))note.hidden=true;
const board=document.createElement('div');board.id='mail-task-board';
const taskDetail=document.createElement('section');taskDetail.id='mail-task-detail';taskDetail.hidden=true;
const memoQuick=document.createElement('details');memoQuick.className='task-panel memo-quick';const memoQuickTitle=document.createElement('summary');memoQuickTitle.textContent='빠른 메모';const memoQuickForm=document.createElement('div');memoQuick.append(memoQuickTitle,memoQuickForm);
const memoPage=document.createElement('section');memoPage.id='local-memo-page';memoPage.hidden=true;
const mailDetails=document.createElement('details');mailDetails.className='task-mail-details';const summary=document.createElement('summary');summary.textContent='메일 목록 · 분류 보기';mailDetails.append(summary);
for(const child of [...view.children])if(![heading,intro,el('outlook-review'),el('outlook-message')].includes(child))mailDetails.append(child);
intro.after(memoQuick,board,mailDetails,taskDetail,memoPage);
el('outlook-classification-section').hidden=true;
const workflow=el('outlook-workflow').parentElement;workflow.querySelector('h3').textContent='처리 상태와 판단 근거';for(const hint of workflow.querySelectorAll('p'))hint.hidden=true;el('outlook-workflow').hidden=true;
const original=document.createElement('details');original.className='task-mail-details';const originalTitle=document.createElement('summary');originalTitle.textContent='메일 원문 펼치기';original.append(originalTitle);el('outlook-meta').before(original);original.append(el('outlook-meta'),el('outlook-body'));
el('outlook-triage-note').hidden=true;
let taskSequence=0,taskMails=new Map(),currentView='dashboard';
let work,followups,threadReview,agenda,agendaRoot;const protectedMailIds=new Set(),localSources=new Map();
const activate=id=>{for(const nav of document.querySelectorAll('.side-nav .nav-button'))nav.classList.toggle('active',nav.id===id);};
const connection=initCRMConnection({onConnected(){followups?.start();threadReview?.start();el('user-email').textContent='CRM 연결됨 · 메모는 이 PC에 저장';if(currentView==='register')void work.register();else if(currentView==='history')void work.history();else void dashboard();},onDisconnected(){followups?.stop();threadReview?.stop();agenda?.stop();protectedMailIds.clear();localSources.clear();work?.reset();el('user-email').textContent='업무 조회 · 메모는 이 PC에 저장';el('action-list').replaceChildren();el('inquiry-list').replaceChildren();message('dashboard-message','저장된 문의와 이력은 CRM 계정 연결 후 확인할 수 있습니다.');void dashboard();}});
function viewChanged(name){taskSequence++;currentView=name;memoPage.hidden=true;taskDetail.hidden=true;taskDetail.replaceChildren();memoQuick.hidden=!['dashboard','outlook'].includes(name);board.hidden=name==='dashboard'&&connection.isConnected();heading.hidden=false;intro.hidden=false;mailDetails.hidden=false;el('outlook-review').hidden=true;if(name==='dashboard'){el('dashboard-view').querySelector('.summary-strip').after(memoQuick,board);activate('nav-dashboard');}else if(name==='outlook'){intro.after(memoQuick,board);activate(el('outlook-category-filter').value==='HQ 업무'?'nav-hq':'nav-customer');}else activate(name==='register'?'nav-register':name==='history'?'nav-history':'');}
function counts(){if(connection.isConnected())return;const groups=taskGroups([...taskMails.values()]);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());el('today-count').textContent=groups.action.filter(m=>m.work_review?.due_date===today).length;el('overdue-count').textContent=groups.action.filter(m=>m.work_review?.due_date&&m.work_review.due_date<today).length;el('waiting-count').textContent=groups.waiting.length;}
async function dashboard(){agenda?.start();board.hidden=connection.isConnected();if(agendaRoot)agendaRoot.hidden=!connection.isConnected();for(const id of ['action-list','inquiry-list'])el(id).closest('section').hidden=connection.isConnected();el('today-label').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long'}).format(new Date());el('outlook-category-filter').value='all';el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));el('outlook-category-filter').dispatchEvent(new Event('change'));if(!connection.isConnected()){message('dashboard-message','담당 메일의 할 일을 표시합니다. 저장된 문의와 이력은 CRM 계정 연결 후 함께 확인할 수 있습니다.');return;}const active=taskSequence;try{const data=await connection.api('/api/dashboard');if(active!==taskSequence)return;for(const id of ['action-list','inquiry-list'])el(id).replaceChildren();for(const [rows,id] of [[data.actions,'action-list'],[data.inquiries,'inquiry-list']]){for(const row of rows){const li=document.createElement('li'),button=document.createElement('button');button.textContent=row.description||row.title;button.addEventListener('click',()=>work.open(row.inquiry_id||row.id));li.append(button);el(id).append(li);}if(!rows.length){const li=document.createElement('li');li.textContent='등록된 항목이 없습니다.';el(id).append(li);}}message('dashboard-message',data.truncated?'CRM 저장 업무는 최근 100건씩 표시합니다.':'담당 메일과 CRM에 저장된 업무를 함께 확인할 수 있습니다.');}catch(error){if(active===taskSequence)message('dashboard-message',error.message,true);}}
el('dashboard-view').querySelector('h1').textContent='홈 대시보드';
el('action-list').closest('section').querySelector('h2').textContent='CRM에 저장된 미완료 Action';el('inquiry-list').closest('section').querySelector('h2').textContent='CRM에 저장된 진행 문의';
function showHome(){work.show(currentView==='dashboard'?'dashboard':'outlook');}
async function openTask(id){
 const listed=taskMails.get(id);if(!listed)return;const sequence=++taskSequence;
 try{const {mail}=await api('/api/outlook/'+id);if(sequence!==taskSequence)return;
  renderTaskDetail(taskDetail,{...mail,handling:listed.handling},()=>{showHome();if(currentView==='dashboard')void dashboard();},async()=>{
   if(!connection.isConnected()){connection.show();return;}
   try{
    const {mail:saved}=await connection.api('/api/outlook/'+id);
    if(sequence!==taskSequence)return;
    if(saved.state==='linked'&&saved.inquiry_id){await work.open(saved.inquiry_id);return;}
    work.show('outlook');board.hidden=true;heading.hidden=true;intro.hidden=true;mailDetails.hidden=true;memoQuick.hidden=true;
    await work.reviewMail(id);
   }catch(error){message('outlook-message',error.message,true);}
  });el('dashboard-view').hidden=true;view.hidden=false;taskDetail.hidden=false;memoQuick.hidden=true;board.hidden=true;heading.hidden=true;intro.hidden=true;mailDetails.hidden=true;el('outlook-review').hidden=true;taskDetail.scrollIntoView({block:'start',behavior:'smooth'});
 }catch(error){if(sequence===taskSequence)message('outlook-message',error.message,true);}
}
const outlookApi=async(path,method,body)=>{
 const url=new URL(path,'http://127.0.0.1:4327'),parts=url.pathname.split('/'),mailId=parts[3];
 if(url.pathname==='/api/outlook'&&url.searchParams.has('inquiry_id')){
  const data=await connection.api(path,method,body),iid=url.searchParams.get('inquiry_id');
  const sources=await connection.api('/api/followups?view=sources&inquiry_id='+encodeURIComponent(iid));
  for(const mail of sources.mails){localSources.set(mail.id,iid);if(!data.mails.some(m=>m.id===mail.id))data.mails.push(mail);}data.hasMore||=sources.hasMore;
  for(const mail of data.mails)protectedMailIds.add(mail.id);return data;
 }
 if(connection.isConnected()&&url.pathname==='/api/outlook'&&url.searchParams.get('view')==='reviewed'){
  const local=await api(path),saved=await connection.api(path),byId=new Map(local.mails.map(m=>[m.id,m]));
  for(const mail of saved.mails){mail.work_review=byId.get(mail.id)?.work_review;protectedMailIds.add(mail.id);}
  if(!Number(url.searchParams.get('offset')||0)){
   const analysis=await connection.api('/api/followups?view=analysis'),category=url.searchParams.get('category')||'all';
   for(const t of analysis.threads.filter(t=>t.local_mail&&(category==='all'||t.local_mail.category_group===category))){
    const mail={...t.local_mail,work_review:{task_bucket:t.current.status==='closed'?'responded':t.observation?.bucket==='waiting'?'waiting':'action',task_owner:'Candy',task_title:t.current.title,status:t.current.status,next_action:t.observation?.next_action||t.current.next_action,task_note:'확인된 담당 규칙과 메일 수신·발신 근거',due_date:t.current.actions.find(a=>a.status==='open')?.due_date}};
    localSources.set(mail.id,t.inquiry_id);protectedMailIds.add(mail.id);if(!saved.mails.some(m=>m.id===mail.id))saved.mails.push(mail);
   }
  }return saved;
 }
 if(connection.isConnected()&&['/api/lookups','/api/inquiries'].includes(url.pathname))return connection.api(path,method,body);
 if(connection.isConnected()&&mailId&&localSources.has(mailId)&&(!method||method==='GET'))return connection.api('/api/followups?view=sources&inquiry_id='+encodeURIComponent(localSources.get(mailId))+'&mail_id='+encodeURIComponent(mailId));
 if(connection.isConnected()&&mailId&&(protectedMailIds.has(mailId)||taskMails.get(mailId)?.handling?.include)){
  const data=await connection.api(path,method,body);
  // VPN mail is linked to a summary inquiry, never copied into a new inquiry.
  if(data.mail&&taskMails.get(mailId)?.handling?.case_id==='M20-10')data.mail.original={...data.mail.original,body:'VPN 관련 원문은 보안상 표시하지 않습니다. 자격증명이 없는 요약 문의를 만든 뒤 기존 문의에 연결하세요.'};
  return data;
 }
 return api(path,method,body);
};
work=initWorkspace(connection.api,dashboard,message,{preserveLocal:true,onShow:viewChanged,outlook:{api:outlookApi,onList:(mails,listView)=>{if(listView==='reviewed'){taskMails=new Map(mails.map(m=>[m.id,m]));renderTaskBoard(board,mails,openTask);board.hidden=currentView==='dashboard'&&connection.isConnected();counts();}}}});
const followupRoot=document.createElement('section');followupRoot.className='task-panel';followupRoot.id='crm-followups';el('dashboard-view').querySelector('.summary-strip').before(followupRoot);
followups=initFollowups({root:followupRoot,api:connection.api,isConnected:connection.isConnected,open:id=>work.open(id),label:id=>taskMails.get(id)?.subject,onChecked:async()=>{
 const result=await connection.api('/api/followups','POST',{operation:'reconcile'});
 if(result.imported)message('dashboard-message',`새 고객 요청 ${result.imported}건의 문의·할 일·수신 이력을 자동 등록했습니다.`);
 if(result.recorded)message('dashboard-message',`새 메일 이력 ${result.recorded}건을 업무에 반영했습니다. 질문 해결·업무 완료 판단은 보존합니다.`);
 if(result.remaining)message('dashboard-message',`새 요청 ${result.remaining}건이 더 남았습니다. 지금 메일 확인으로 이어서 처리하세요.`);
 threadReview?.start();agenda?.start();
}});
const reviewRoot=document.createElement('details');reviewRoot.className='task-panel';reviewRoot.id='mail-thread-review';const reviewSummary=document.createElement('summary');reviewSummary.textContent='메일 대조 상세 · 할 일 제안';reviewRoot.append(reviewSummary);followupRoot.after(reviewRoot);
threadReview=initThreadReview({root:reviewRoot,api:connection.api,isConnected:connection.isConnected,open:id=>work.open(id),prepare:(id,text)=>work.prepareAction(id,text)});
agendaRoot=document.createElement('section');agendaRoot.id='work-agenda';agendaRoot.className='task-panel';agendaRoot.hidden=true;followupRoot.after(agendaRoot);
agenda=initWorkAgenda({root:agendaRoot,api:connection.api,isConnected:connection.isConnected,open:id=>work.open(id),onCounts:groups=>{
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),actions=Object.values(groups).flat().flatMap(row=>row.actions);
 el('today-count').textContent=actions.filter(a=>a.due_date===today).length;el('overdue-count').textContent=actions.filter(a=>a.due_date&&a.due_date<today).length;el('waiting-count').textContent=groups.waiting.length;
}});

for(const [id,label,category] of [['nav-customer','고객 업무','고객 업무'],['nav-hq','HQ 업무','HQ 업무']]){const button=document.createElement('button');button.id=id;button.type='button';button.className='nav-button';button.textContent=label;el('nav-register').before(button);button.addEventListener('click',()=>{el('outlook-category-filter').value=category;work.show('outlook');el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));el('outlook-category-filter').dispatchEvent(new Event('change'));});}
el('nav-dashboard').textContent='홈 대시보드';el('nav-register').textContent='문의 등록';el('nav-history').textContent='문의 조회 · 종료 이력';
el('reload-button').addEventListener('click',dashboard);
el('nav-outlook').hidden=true;
const memoApi=async(path,method='GET',body)=>{const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'메모 저장을 확인하지 못했습니다. 입력은 유지됩니다.');return data;};
const memos=initMemos({quickRoot:memoQuickForm,pageRoot:memoPage,api:memoApi});
const memoMenu=document.createElement('button');memoMenu.id='nav-memos';memoMenu.className='nav-button';memoMenu.textContent='메모';memoMenu.type='button';document.querySelector('.side-nav').append(memoMenu);memoMenu.addEventListener('click',()=>{work.show('outlook');currentView='memos';memoPage.hidden=false;memoQuick.hidden=true;for(const element of [board,heading,intro,mailDetails])element.hidden=true;for(const nav of document.querySelectorAll('.side-nav .nav-button'))nav.classList.toggle('active',nav===memoMenu);void memos.load();});
window.addEventListener('beforeunload',event=>{if(memos.hasDraft()){event.preventDefault();event.returnValue='';}});
const blocked=['outlook-start','outlook-review-sync','outlook-workflow','outlook-classify','outlook-triage'];
const disable=()=>{for(const id of blocked)if(el(id)&&!el(id).disabled)el(id).disabled=true;};
new MutationObserver(disable).observe(el('workspace'),{subtree:true,attributes:true,attributeFilter:['disabled']});disable();
el('logout-button').hidden=true;work.show('dashboard');void dashboard();

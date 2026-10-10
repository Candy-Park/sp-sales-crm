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
let work;const protectedMailIds=new Set();
const activate=id=>{for(const nav of document.querySelectorAll('.side-nav .nav-button'))nav.classList.toggle('active',nav.id===id);};
const connection=initCRMConnection({onConnected(){el('user-email').textContent='CRM 연결됨 · 메모는 이 PC에 저장';if(currentView==='register')void work.register();else if(currentView==='history')void work.history();else void dashboard();},onDisconnected(){protectedMailIds.clear();work?.reset();el('user-email').textContent='업무 조회 · 메모는 이 PC에 저장';el('action-list').replaceChildren();el('inquiry-list').replaceChildren();message('dashboard-message','저장된 문의와 이력은 CRM 계정 연결 후 확인할 수 있습니다.');void dashboard();}});
function viewChanged(name){taskSequence++;currentView=name;memoPage.hidden=true;taskDetail.hidden=true;taskDetail.replaceChildren();memoQuick.hidden=!['dashboard','outlook'].includes(name);board.hidden=false;heading.hidden=false;intro.hidden=false;mailDetails.hidden=false;el('outlook-review').hidden=true;if(name==='dashboard'){el('dashboard-view').querySelector('.summary-strip').after(memoQuick,board);activate('nav-dashboard');}else if(name==='outlook'){intro.after(memoQuick,board);activate(el('outlook-category-filter').value==='HQ 업무'?'nav-hq':'nav-customer');}else activate(name==='register'?'nav-register':name==='history'?'nav-history':'');}
function counts(){const groups=taskGroups([...taskMails.values()]);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());el('today-count').textContent=groups.action.filter(m=>m.work_review?.due_date===today).length;el('overdue-count').textContent=groups.action.filter(m=>m.work_review?.due_date&&m.work_review.due_date<today).length;el('waiting-count').textContent=groups.waiting.length;}
async function dashboard(){el('today-label').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long'}).format(new Date());el('outlook-category-filter').value='all';el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));el('outlook-category-filter').dispatchEvent(new Event('change'));if(!connection.isConnected()){message('dashboard-message','담당 메일의 할 일을 표시합니다. 저장된 문의와 이력은 CRM 계정 연결 후 함께 확인할 수 있습니다.');return;}const active=taskSequence;try{const data=await connection.api('/api/dashboard');if(active!==taskSequence)return;for(const id of ['action-list','inquiry-list'])el(id).replaceChildren();for(const [rows,id] of [[data.actions,'action-list'],[data.inquiries,'inquiry-list']]){for(const row of rows){const li=document.createElement('li'),button=document.createElement('button');button.textContent=row.description||row.title;button.addEventListener('click',()=>work.open(row.inquiry_id||row.id));li.append(button);el(id).append(li);}if(!rows.length){const li=document.createElement('li');li.textContent='등록된 항목이 없습니다.';el(id).append(li);}}message('dashboard-message',data.truncated?'CRM 저장 업무는 최근 100건씩 표시합니다.':'담당 메일과 CRM에 저장된 업무를 함께 확인할 수 있습니다.');}catch(error){if(active===taskSequence)message('dashboard-message',error.message,true);}}
el('dashboard-view').querySelector('h1').textContent='홈 대시보드';
el('action-list').closest('section').querySelector('h2').textContent='CRM에 저장된 미완료 Action';el('inquiry-list').closest('section').querySelector('h2').textContent='CRM에 저장된 진행 문의';
function showHome(){work.show(currentView==='dashboard'?'dashboard':'outlook');}
async function openTask(id){
 const listed=taskMails.get(id);if(!listed)return;const sequence=++taskSequence;
 try{const {mail}=await api('/api/outlook/'+id);if(sequence!==taskSequence)return;
  renderTaskDetail(taskDetail,{...mail,handling:listed.handling},()=>{showHome();if(currentView==='dashboard')void dashboard();});el('dashboard-view').hidden=true;view.hidden=false;taskDetail.hidden=false;memoQuick.hidden=true;board.hidden=true;heading.hidden=true;intro.hidden=true;mailDetails.hidden=true;el('outlook-review').hidden=true;taskDetail.scrollIntoView({block:'start',behavior:'smooth'});
 }catch(error){if(sequence===taskSequence)message('outlook-message',error.message,true);}
}
const outlookApi=async(path,method,body)=>{const url=new URL(path,'http://127.0.0.1:4327');if(url.pathname==='/api/outlook'&&url.searchParams.has('inquiry_id')){const data=await connection.api(path,method,body);for(const mail of data.mails)protectedMailIds.add(mail.id);return data;}if(protectedMailIds.has(url.pathname.split('/').at(-1)))return connection.api(path,method,body);return api(path,method,body);};
work=initWorkspace(connection.api,dashboard,message,{preserveLocal:true,onShow:viewChanged,outlook:{api:outlookApi,onList:(mails,listView)=>{if(listView==='reviewed'){taskMails=new Map(mails.map(m=>[m.id,m]));renderTaskBoard(board,mails,openTask);counts();}}}});
for(const [id,label,category] of [['nav-customer','고객 업무','고객 업무'],['nav-hq','HQ 업무','HQ 업무']]){const button=document.createElement('button');button.id=id;button.type='button';button.className='nav-button';button.textContent=label;el('nav-register').before(button);button.addEventListener('click',()=>{el('outlook-category-filter').value=category;work.show('outlook');el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));el('outlook-category-filter').dispatchEvent(new Event('change'));});}
el('nav-dashboard').textContent='홈 대시보드';el('nav-register').textContent='문의 등록';el('nav-history').textContent='문의 조회 · 종료 이력';
el('reload-button').addEventListener('click',dashboard);
el('nav-outlook').hidden=true;
const memoApi=async(path,method='GET',body)=>{const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'메모 저장을 확인하지 못했습니다. 입력은 유지됩니다.');return data;};
const memos=initMemos({quickRoot:memoQuickForm,pageRoot:memoPage,api:memoApi});
const memoMenu=document.createElement('button');memoMenu.id='nav-memos';memoMenu.className='nav-button';memoMenu.textContent='메모';memoMenu.type='button';document.querySelector('.side-nav').append(memoMenu);memoMenu.addEventListener('click',()=>{work.show('outlook');currentView='memos';memoPage.hidden=false;memoQuick.hidden=true;for(const element of [board,heading,intro,mailDetails])element.hidden=true;for(const nav of document.querySelectorAll('.side-nav .nav-button'))nav.classList.toggle('active',nav===memoMenu);void memos.load();});
window.addEventListener('beforeunload',event=>{if(memos.hasDraft()){event.preventDefault();event.returnValue='';}});
const blocked=['outlook-start','outlook-review-sync','outlook-workflow','outlook-classify','outlook-link-save','outlook-triage','outlook-linked-open'];
const disable=()=>{for(const id of blocked)if(el(id)&&!el(id).disabled)el(id).disabled=true;};
new MutationObserver(disable).observe(el('workspace'),{subtree:true,attributes:true,attributeFilter:['disabled']});disable();
el('logout-button').hidden=true;work.show('dashboard');void dashboard();

import {initWorkspace} from './workspace.mjs';
import {initCRMConnection} from './crm-connection.mjs';
import {initWorkAgenda} from './work-agenda.mjs';
import {initThreadReview} from './mail-thread-review.mjs';
import {initFollowups} from './crm-followups.mjs';
import {initMemos} from './local-memos.mjs';
import {initGlassTheme} from './glass-theme.mjs';
import {renderTaskBoard} from './mail-task-board.mjs';
const el=id=>document.getElementById(id);
const message=(id,text,error=false)=>{el(id).textContent=text;el(id).classList.toggle('error',error);};
el('login-view').hidden=true;el('workspace').hidden=false;el('workspace').classList.add('task-preview');
initGlassTheme({root:document.body,controls:document.querySelector('.account')});
let work,agenda,review,follow,memos,current='dashboard',epoch=0;
const connection=initCRMConnection({onConnected(user){epoch++;el('user-email').textContent=user.email;follow.start();review.start();void memos.load();work.show('dashboard');void dashboard();},onDisconnected(){epoch++;follow?.stop();review?.stop();agenda?.stop();memos?.reset();customerBoard.replaceChildren();taskMails.clear();work?.reset();memoPage.hidden=true;el('user-email').textContent='계정을 연결해 업무를 확인하세요.';for(const id of ['action-list','inquiry-list','outlook-list'])el(id).replaceChildren();for(const id of ['today-count','overdue-count','waiting-count'])el(id).textContent='—';message('dashboard-message','로그인 후 저장된 업무와 메모를 확인할 수 있습니다.');}});
const api=connection.api;
const customerBoard=document.createElement('section');customerBoard.id='mail-task-board';el('outlook-view').querySelector('h1').nextElementSibling.after(customerBoard);
let taskMails=new Map();
const outlookApi=async(path,method,body)=>{
 const data=await api(path,method,body),url=new URL(path,location.origin);
 if(url.pathname==='/api/outlook'&&url.searchParams.get('view')==='reviewed'){
  const analysis=await api('/api/followups?view=analysis'),current=new Map(analysis.threads.map(t=>[t.inquiry_id,t]));
  for(const mail of data.mails){const t=current.get(mail.inquiry_id);if(!t)continue;const due=t.current.actions.filter(a=>a.status==='open'&&a.due_date).map(a=>a.due_date).sort()[0];
   mail.work_review={...mail.work_review,task_bucket:t.current.status==='closed'?'responded':t.observation?.bucket==='waiting'?'waiting':mail.work_review?.task_bucket,next_action:t.current.next_action,...(due?{due_date:due,task_date_label:'기한 '+due}:{})};
  }
 }
 return data;
};
const memoQuick=document.createElement('details');memoQuick.className='task-panel memo-quick';const mqTitle=document.createElement('summary');mqTitle.textContent='빠른 메모';const mqForm=document.createElement('div');memoQuick.append(mqTitle,mqForm);
const memoPage=document.createElement('section');memoPage.id='local-memo-page';memoPage.hidden=true;el('outlook-view').after(memoPage);
el('dashboard-view').querySelector('.summary-strip').after(memoQuick);
const followRoot=document.createElement('section');followRoot.className='task-panel';followRoot.id='crm-followups';el('dashboard-view').querySelector('.summary-strip').before(followRoot);
const agendaRoot=document.createElement('section');agendaRoot.className='task-panel';agendaRoot.id='work-agenda';followRoot.after(agendaRoot);
const reviewRoot=document.createElement('details');reviewRoot.className='task-panel';reviewRoot.id='mail-thread-review';const summary=document.createElement('summary');summary.textContent='메일 대조 상세 · 할 일 제안';reviewRoot.append(summary);agendaRoot.after(reviewRoot);
function activate(id){for(const nav of document.querySelectorAll('.side-nav .nav-button'))nav.classList.toggle('active',nav.id===id);}
function viewChanged(name){current=name;memoPage.hidden=true;memoQuick.hidden=!['dashboard','outlook'].includes(name);activate(name==='outlook'?el('outlook-category-filter').value==='HQ 업무'?'nav-hq':'nav-customer':'nav-'+name);}
async function dashboard(){if(!connection.isConnected())return;el('today-label').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long'}).format(new Date());message('dashboard-message','저장된 업무를 확인합니다.메일 관측 자료는 마지막 PC 동기화 기준입니다.');follow.start();agenda.start();}
// Only verified cloud API calls; no anonymous PC preview or local SQLite endpoints.
work=initWorkspace(api,dashboard,message,{onShow:viewChanged,outlook:{api:outlookApi,onList(mails,view){if(view!=='reviewed')return;taskMails=new Map(mails.map(m=>[m.id,m]));renderTaskBoard(customerBoard,mails,id=>{const mail=taskMails.get(id);if(mail?.state==='linked'&&mail.inquiry_id)void work.open(mail.inquiry_id);else void work.reviewMail(id);});}}});
for(const id of ['action-list','inquiry-list'])el(id).closest('section').hidden=true;
follow=initFollowups({root:followRoot,api,remote:true,isConnected:connection.isConnected,open:id=>work.open(id),onChecked:async()=>{review.start();agenda.start();}});
review=initThreadReview({root:reviewRoot,api,isConnected:connection.isConnected,open:id=>work.open(id),prepare:(id,text)=>work.prepareAction(id,text)});
agenda=initWorkAgenda({root:agendaRoot,api,isConnected:connection.isConnected,open:id=>work.open(id),onCounts:groups=>{const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),actions=Object.values(groups).flat().flatMap(r=>r.actions);el('today-count').textContent=actions.filter(a=>a.due_date===today).length;el('overdue-count').textContent=actions.filter(a=>a.due_date&&a.due_date<today).length;el('waiting-count').textContent=groups.waiting.length;}});
memos=initMemos({quickRoot:mqForm,pageRoot:memoPage,api,autoload:false,cloud:true});
for(const [id,label,category] of [['nav-customer','고객 업무','고객 업무'],['nav-hq','HQ 업무','HQ 업무']]){const button=document.createElement('button');button.id=id;button.type='button';button.className='nav-button';button.textContent=label;el('nav-register').before(button);button.addEventListener('click',()=>{if(!connection.isConnected()){connection.show();return;}el('outlook-category-filter').value=category;work.show('outlook');el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));el('outlook-category-filter').dispatchEvent(new Event('change'));});}
const memoMenu=document.createElement('button');memoMenu.id='nav-memos';memoMenu.type='button';memoMenu.className='nav-button';memoMenu.textContent='메모';document.querySelector('.side-nav').append(memoMenu);memoMenu.addEventListener('click',()=>{if(!connection.isConnected()){connection.show();return;}work.show('outlook');el('outlook-view').hidden=true;current='memos';memoPage.hidden=false;memoQuick.hidden=true;activate('nav-memos');void memos.load();});
el('nav-outlook').hidden=true;el('mobile-outlook').textContent='고객 업무';el('mobile-outlook').addEventListener('click',()=>el('nav-customer').click());
el('nav-dashboard').textContent='홈 대시보드';el('dashboard-view').querySelector('h1').textContent='홈 대시보드';el('nav-register').textContent='문의 등록';
const outlookView=el('outlook-view');outlookView.querySelector('h1').textContent='담당 업무';outlookView.querySelector('h1').nextElementSibling.textContent='동기화한 고객·HQ 업무입니다. 업무 상세에서 현재 할 일과 기한을 확인하세요.';
for(const id of ['outlook-start','outlook-review-sync','outlook-workflow','outlook-classify','outlook-triage']){el(id).hidden=true;el(id).disabled=true;}
el('outlook-classification-section').hidden=true;el('outlook-classification-filter').parentElement.hidden=true;
for(const option of [...el('outlook-filter').options])if(option.value!=='reviewed')option.remove();
for(const p of outlookView.querySelectorAll('p'))if(p.textContent.startsWith('오늘 검토본은'))p.hidden=true;
el('outlook-filter').value='reviewed';el('reload-button').addEventListener('click',dashboard);
const mailList=document.createElement('details'),mailListTitle=document.createElement('summary');mailListTitle.textContent='근거 메일 목록 펼치기';mailList.append(mailListTitle,el('outlook-list'),el('outlook-prev'),el('outlook-next'));customerBoard.after(mailList);
window.addEventListener('beforeunload',event=>{if(memos.hasDraft()){event.preventDefault();event.returnValue='';}});
work.show('dashboard');message('dashboard-message','로그인 후 저장된 업무와 메모를 확인할 수 있습니다.');el('user-email').textContent='PC가 꺼져도 저장된 업무 사용 가능';
await connection.ready;connection.show();

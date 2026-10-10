import {initOutlook} from '../web/outlook.mjs';
import {renderTaskBoard} from '../web/mail-task-board.mjs';
import {renderTaskDetail} from '../web/mail-task-detail.mjs';
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
el('user-email').textContent='메일 근거로 정리한 업무 · 읽기 전용';
const view=el('outlook-view'),heading=view.querySelector('h1'),intro=heading.nextElementSibling;
heading.textContent='내가 할 일';intro.textContent='할 일과 날짜를 먼저 보고, 필요한 메일만 펼쳐 확인하세요.';
for(const id of ['outlook-start','outlook-review-sync','outlook-status','logout-button'])el(id).hidden=true;
for(const note of el('outlook-view').querySelectorAll('p'))if(note.textContent.startsWith('오늘 검토본은'))note.hidden=true;
const board=document.createElement('div');board.id='mail-task-board';
const taskDetail=document.createElement('section');taskDetail.id='mail-task-detail';taskDetail.hidden=true;
const mailDetails=document.createElement('details');mailDetails.className='task-mail-details';const summary=document.createElement('summary');summary.textContent='메일 목록 · 분류 보기';mailDetails.append(summary);
for(const child of [...view.children])if(![heading,intro,el('outlook-review'),el('outlook-message')].includes(child))mailDetails.append(child);
intro.after(board,mailDetails,taskDetail);
el('outlook-classification-section').hidden=true;
const workflow=el('outlook-workflow').parentElement;workflow.querySelector('h3').textContent='처리 상태와 판단 근거';for(const hint of workflow.querySelectorAll('p'))hint.hidden=true;el('outlook-workflow').hidden=true;
const original=document.createElement('details');original.className='task-mail-details';const originalTitle=document.createElement('summary');originalTitle.textContent='메일 원문 펼치기';original.append(originalTitle);el('outlook-meta').before(original);original.append(el('outlook-meta'),el('outlook-body'));
el('outlook-triage-note').hidden=true;
let taskSequence=0,taskMails=new Map();
function showHome(){taskSequence++;taskDetail.hidden=true;taskDetail.replaceChildren();board.hidden=false;heading.hidden=false;intro.hidden=false;mailDetails.hidden=false;el('outlook-review').hidden=true;}
async function openTask(id){
 const listed=taskMails.get(id);if(!listed)return;const sequence=++taskSequence;
 try{const {mail}=await api('/api/outlook/'+id);if(sequence!==taskSequence)return;
  renderTaskDetail(taskDetail,{...mail,handling:listed.handling},showHome);taskDetail.hidden=false;board.hidden=true;heading.hidden=true;intro.hidden=true;mailDetails.hidden=true;el('outlook-review').hidden=true;taskDetail.scrollIntoView({block:'start',behavior:'smooth'});
 }catch(error){if(sequence===taskSequence)message('outlook-message',error.message,true);}
}
initOutlook({api,message,show:()=>{view.hidden=false;},onList:(mails,listView)=>{if(listView==='reviewed'){taskMails=new Map(mails.map(m=>[m.id,m]));renderTaskBoard(board,mails,openTask);}},open:async()=>{message('outlook-message','기존 문의 연결은 그대로 보존돼 있습니다. 이 화면은 메일 기준 확인용입니다.');}});
for(const [id,label,category] of [['nav-dashboard','홈','all'],['nav-register','고객 업무','고객 업무'],['nav-history','HQ 업무','HQ 업무']]){
 const button=el(id);button.textContent=label;button.disabled=false;button.addEventListener('click',()=>{showHome();for(const nav of document.querySelectorAll('.side-nav .nav-button'))nav.classList.toggle('active',nav===button);el('outlook-category-filter').value=category;el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));el('outlook-category-filter').dispatchEvent(new Event('change'));});
}
el('nav-outlook').hidden=true;
const blocked=['logout-button','mobile-dashboard','mobile-register','mobile-history','outlook-start','outlook-review-sync','outlook-workflow','outlook-classify','outlook-link-save','outlook-triage','outlook-linked-open'];
const disable=()=>{for(const id of blocked)if(el(id)&&!el(id).disabled)el(id).disabled=true;};
new MutationObserver(disable).observe(el('workspace'),{subtree:true,attributes:true,attributeFilter:['disabled']});disable();
el('nav-dashboard').classList.add('active');el('nav-outlook').click();
el('outlook-filter').value='reviewed';el('outlook-filter').dispatchEvent(new Event('change'));

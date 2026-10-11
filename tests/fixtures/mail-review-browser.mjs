import {initWorkspace} from '../../web/workspace.mjs';
import {initThreadReview} from '../../web/mail-thread-review.mjs';
import {initFollowups} from '../../web/crm-followups.mjs';
import {initWorkAgenda} from '../../web/work-agenda.mjs';
import {reconcileRequests,reconcileEvents} from '../../src/crm-mail-import.mjs';
const el=id=>document.getElementById(id),iid='00000000-0000-4000-8000-000000000001';
let connected=true,fail=false,actions=[];
const newId='00000000-0000-4000-8000-000000000002',source='a'.repeat(64);
let arrival=false,imported=false,outgoing=false,newInquiry=null,newActions=[],newMessages=[],checked=0;
const candidate={source_key:source,category:'고객 업무',subject:'합성 고객 · 신규 사양 요청',customer:'합성 고객',customer_id:iid,occurred_at:'2026-10-11T00:00:00Z',excerpt:'SYNTHETIC ONLY: Please send specification.',next_action:'신규 사양 요청에 답변',evidence:['합성 확인 고객 도메인','직접 수신 Candy'],automatic_registration:true};
const inquiry={id:iid,title:'합성 고객 · 패킹 사양 확인',status:'new',original_text:'SYNTHETIC ONLY · 실제 메일이 아닙니다.',next_action:'추가 제품 사양 확인',received_at:'2026-10-11T00:00:00Z',updated_at:'2026-10-11T00:00:00Z',revision:1};
const message=(id,text)=>{el(id).textContent=text;};
async function api(path,method='GET',body){
 if(fail)throw Error('합성 오류: 입력과 기존 업무 보존 검증');
 if(!connected)throw Error('모의 세션 종료');
 if(path==='/api/followups?view=analysis')return {candidates:arrival?[{...candidate,inquiry_id:imported?newId:null}]:[],threads:[{mail_id:iid,inquiry_id:iid,current:{...inquiry,actions},received:2,sent:1,proposal:{next_action:'추가 요청 제품의 패킹 사양 확인'},timeline:[{occurred_at:'2026-10-11T00:00:00Z',direction:'received',excerpt:'SYNTHETIC ONLY: 추가 제품의 패킹 사양서를 요청합니다.'}],omitted:0},...(imported?[{mail_id:newId,inquiry_id:newId,current:{...newInquiry,actions:newActions,review:{task_owner:'Candy'}},received:1,sent:outgoing?1:0,proposal:{next_action:candidate.next_action},timeline:[{occurred_at:candidate.occurred_at,direction:'received',excerpt:candidate.excerpt},...(outgoing?[{occurred_at:'2026-10-11T01:00:00Z',direction:'sent',excerpt:'SYNTHETIC ONLY: specification reply sent.'}]:[])],observation:{bucket:outgoing?'waiting':'action',next_action:outgoing?'고객 회신 메일 확인: 피드백 대기, 남은 질문 확인':candidate.next_action}}]:[])]};
 if(path==='/api/followups'&&body?.operation==='reconcile'){
 const result=await reconcileRequests({candidates:arrival?[{...candidate,inquiry_id:imported?newId:null}]:[]},{owner:iid,targets:[]},async input=>{
  if(input.mode==='ack'){imported=true;return {saved:true};}
  return {source_key:source,registration:{id:newId,title:candidate.subject,customer_id:iid,channel:'Outlook',received_at:candidate.occurred_at,original_text:candidate.excerpt,next_action:candidate.next_action},action:{id:newId,kind:'customer_reply',description:candidate.next_action,due_date:'2026-10-14',mandatory:true},message:{id:newId,kind:'customer_received',body:candidate.excerpt,target:'합성 고객',subject:candidate.subject,occurred_at:candidate.occurred_at}};
 },async(path,body)=>Response.json(await api(path,'POST',body)));
 const events=outgoing&&imported?[{inquiry_id:newId,message:{id:'00000000-0000-4000-8000-000000000003',kind:'customer_sent',target:'합성 고객',subject:candidate.subject,occurred_at:'2026-10-11T01:00:00Z',actual_confirmed:true,body:'SYNTHETIC ONLY: specification reply sent.'}}]:[];
 const history=await reconcileEvents({events},async path=>Response.json(await api(path)),async(path,body)=>Response.json(await api(path,'POST',body)));
 return {...result,...history};
 }
 if(path==='/api/followups'){if(method==='POST')checked++;return {ready:true,running:false,last_checked_at:new Date(Date.parse('2026-10-11T00:00:00Z')+checked*1000).toISOString(),updates:[]};}
 if(path==='/api/inquiries'&&method==='POST'){newInquiry={...body,status:'new',revision:1,updated_at:'2026-10-11T00:00:00Z'};return {result:newId};}
 if(path==='/api/inquiries/'+newId+'/actions'&&method==='POST'){if(!newActions.some(a=>a.id===body.id))newActions.push({...body,status:'open',inquiry_id:newId,revision:1});return {result:body.id};}
 if(path==='/api/inquiries/'+newId+'/messages'&&method==='POST'){if(!newMessages.some(m=>m.id===body.id)){newMessages.push(body);if(body.kind==='customer_sent')newInquiry.status='waiting_for_customer';}return {result:body.id};}
 if(path==='/api/inquiries/'+newId+'/communication')return {messages:newMessages,questions:[],reviews:[],truncated:false};
 if(path==='/api/inquiries/'+newId)return {inquiry:newInquiry,actions:newActions};
 if(path==='/api/lookups')return {customers:[],contacts:[],projects:[]};
 if(path==='/api/dashboard')return {inquiries:[inquiry,...(imported?[newInquiry]:[])],actions:[...actions.filter(a=>a.status==='open').map(a=>({...a,inquiry_id:iid})),...newActions],truncated:false};
 if(path.endsWith('/actions')&&method==='POST'){actions.push({...body,inquiry_id:iid,status:'open',revision:1,updated_at:'2026-10-11T00:00:00Z'});return {action:actions.at(-1)};}
 if(path.startsWith('/api/actions/')&&method==='PATCH'){const a=actions.find(a=>a.id===path.split('/').at(-1));if(!a||a.revision!==body.revision)throw Error('합성 수정 충돌');Object.assign(a,body,{revision:a.revision+1});return {action:a};}
 if(path==='/api/inquiries/'+iid)return {inquiry:{...inquiry},actions:[...actions]};
 if(path.endsWith('/communication'))return {messages:[],questions:[],reviews:[],truncated:false};
 if(path.endsWith('/products'))return {links:[]};
 if(path.startsWith('/api/outlook'))return {mails:[],hasMore:false};
 return {inquiries:[],actions:[],hasMore:false};
}
el('login-view').hidden=true;el('workspace').hidden=false;el('logout-button').hidden=true;
el('user-email').textContent='로그인 없는 합성 검증 · 실제 계정·메일·DB 접근 없음';
const banner=document.createElement('p');banner.className='error';banner.textContent='검증 전용 화면입니다. 여기서 저장한 내용은 메모리의 가짜 데이터이며 페이지를 다시 열면 초기화됩니다.';el('workspace').prepend(banner);
const work=initWorkspace(api,()=>{},message);
const root=document.createElement('section');root.className='task-panel';el('dashboard-view').prepend(root);
const followRoot=document.createElement('section');followRoot.className='task-panel';root.after(followRoot);
const review=initThreadReview({root,api,isConnected:()=>connected,open:id=>work.open(id),prepare:(id,text)=>work.prepareAction(id,text)});
const follow=initFollowups({root:followRoot,api,isConnected:()=>connected,open:id=>work.open(id),onChecked:async()=>{await api('/api/followups','POST',{operation:'reconcile'});agenda.start();}});
const agendaRoot=document.createElement('section');agendaRoot.className='task-panel';root.before(agendaRoot);
const agenda=initWorkAgenda({root:agendaRoot,api,isConnected:()=>connected,open:id=>work.open(id)});agenda.start();
for(const [label,handler] of [
 ['새 요청 도착 시험',()=>{arrival=true;agenda.start();}],
 ['고객 발신 시험',()=>{outgoing=true;agenda.start();}],
 ['모의 로그아웃',()=>{connected=false;review.stop();follow.stop();agenda.stop();work.reset();}],
 ['모의 연결',()=>{connected=true;fail=false;review.start();follow.start();agenda.start();}],
 ['조회 오류 시험',()=>{fail=true;review.start();}],
 ['오류 해제',()=>{fail=false;review.start();}]
]){const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',handler);banner.after(b);}
work.show('dashboard');review.start();follow.start();

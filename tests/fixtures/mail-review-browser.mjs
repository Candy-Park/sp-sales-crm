import {initWorkspace} from '../../web/workspace.mjs';
import {initThreadReview} from '../../web/mail-thread-review.mjs';
import {initFollowups} from '../../web/crm-followups.mjs';
import {initWorkAgenda} from '../../web/work-agenda.mjs';
const el=id=>document.getElementById(id),iid='00000000-0000-4000-8000-000000000001';
let connected=true,fail=false,actions=[];
const inquiry={id:iid,title:'합성 고객 · 패킹 사양 확인',status:'new',original_text:'SYNTHETIC ONLY · 실제 메일이 아닙니다.',next_action:'추가 제품 사양 확인',received_at:'2026-10-11T00:00:00Z',updated_at:'2026-10-11T00:00:00Z',revision:1};
const message=(id,text)=>{el(id).textContent=text;};
async function api(path,method='GET',body){
 if(fail)throw Error('합성 오류: 입력과 기존 업무 보존 검증');
 if(!connected)throw Error('모의 세션 종료');
 if(path==='/api/followups?view=analysis')return {threads:[{mail_id:iid,inquiry_id:iid,current:{...inquiry,actions},received:2,sent:1,proposal:{next_action:'추가 요청 제품의 패킹 사양 확인'},timeline:[{occurred_at:'2026-10-11T00:00:00Z',direction:'received',excerpt:'SYNTHETIC ONLY: 추가 제품의 패킹 사양서를 요청합니다.'}],omitted:0}]};
 if(path==='/api/followups')return {ready:true,running:false,last_checked_at:'2026-10-11T00:00:00Z',updates:[]};
 if(path==='/api/lookups')return {customers:[],contacts:[],projects:[]};
 if(path==='/api/dashboard')return {inquiries:[inquiry],actions:actions.filter(a=>a.status==='open').map(a=>({...a,inquiry_id:iid})),truncated:false};
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
const follow=initFollowups({root:followRoot,api,isConnected:()=>connected,open:id=>work.open(id)});
const agendaRoot=document.createElement('section');agendaRoot.className='task-panel';root.before(agendaRoot);
const agenda=initWorkAgenda({root:agendaRoot,api,isConnected:()=>connected,open:id=>work.open(id)});agenda.start();
for(const [label,handler] of [
 ['모의 로그아웃',()=>{connected=false;review.stop();follow.stop();agenda.stop();work.reset();}],
 ['모의 연결',()=>{connected=true;fail=false;review.start();follow.start();agenda.start();}],
 ['조회 오류 시험',()=>{fail=true;review.start();}],
 ['오류 해제',()=>{fail=false;review.start();}]
]){const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',handler);banner.after(b);}
work.show('dashboard');review.start();follow.start();

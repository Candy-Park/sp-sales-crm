import {createClient} from '@supabase/supabase-js';
import {dashboardSummary} from '../src/dashboard.mjs';
import {initWorkspace,statusNames as statuses} from './workspace.mjs';
const el=id=>document.getElementById(id);
let client=null, generation=0,authEpoch=0;
function message(id,text,error=false){el(id).textContent=text;el(id).classList.toggle('error',error);}
function signedOut(){generation++;authEpoch++;work.reset();el('reload-button').disabled=false;el('workspace').hidden=true;el('login-view').hidden=false;el('password').value='';el('action-list').replaceChildren();el('inquiry-list').replaceChildren();el('user-email').textContent='';}
async function api(path,method='GET',body){
  const epoch=authEpoch;
  const {data:{session}}=await client.auth.getSession();
  if(!session) throw new Error('로그인이 필요합니다.');
  const response=await fetch(path,{method,headers:{authorization:'Bearer '+session.access_token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(epoch!==authEpoch)throw new Error('로그인 상태가 변경됐습니다.');
  if(!response.ok){if(response.status===401){signedOut();message('login-message',data.error ?? '로그인이 만료됐습니다. 다시 로그인해주세요.',true);}throw new Error(data.error ?? '요청에 실패했습니다.');}
  return data;
}
function item(list,title,detail,due=''){
  const li=document.createElement('li');const strong=document.createElement('strong');strong.textContent=title;li.append(strong);
  if(due){const span=document.createElement('span');span.className='due';span.textContent=due;li.append(span);}
  const small=document.createElement('small');small.textContent=detail;li.append(small);el(list).append(li);return li;
}
async function dashboard(){
  const active=++generation;const now=new Date().toISOString();
  el('reload-button').disabled=true;message('dashboard-message','업무를 불러오고 있습니다.');
  for(const id of ['today-count','overdue-count','waiting-count'])el(id).textContent='—';
  for(const id of ['action-list','inquiry-list'])el(id).replaceChildren();
  try{
    const data=await api('/api/dashboard');if(active!==generation)return;
    const {today,overdue,waiting}=dashboardSummary(data,now);
    const link=(li,id)=>{const strong=li.querySelector('strong'),button=document.createElement('button');button.textContent=strong.textContent;button.addEventListener('click',()=>work.open(id));strong.replaceWith(button);};
    for(const action of data.actions){link(item('action-list',action.description,'미완료 · '+(action.mandatory?'필수 업무':'선택 업무'),action.due_date ?? '기한 없음'),action.inquiry_id);}
    for(const inquiry of data.inquiries){
      const waiting=inquiry.waiting_target?' · 대기 '+inquiry.waiting_target+' / '+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(inquiry.waiting_since))+' 서울':'';
      link(item('inquiry-list',inquiry.title,(statuses[inquiry.status]??inquiry.status)+waiting+(inquiry.next_action?' · '+inquiry.next_action:'')),inquiry.id);
    }
    el('today-count').textContent=today;el('overdue-count').textContent=overdue;el('waiting-count').textContent=waiting;
    if(!data.actions.length){item('action-list','등록된 미완료 업무가 없습니다.','');el('action-list').firstChild.className='empty';}
    if(!data.inquiries.length){item('inquiry-list','진행 중인 문의가 없습니다.','수동 문의를 등록하거나 종료 이력에서 기존 문의를 확인하세요.');el('inquiry-list').firstChild.className='empty';}
    message('dashboard-message',data.truncated?'최근 100개씩 표시합니다. 집계도 표시된 목록 기준입니다.':'현재 계정의 업무를 확인했습니다.');
  }catch(error){if(active===generation)message('dashboard-message',error.message,true);}
  finally{if(active===generation)el('reload-button').disabled=false;}
}
el('login-form').addEventListener('submit',async(event)=>{
  event.preventDefault();el('login-button').disabled=true;message('login-message','로그인하고 있습니다.');
  const password=el('password').value;el('password').value='';
  try{
    const {error}=await client.auth.signInWithPassword({email:el('email').value.trim(),password});
    if(error)throw new Error('로그인하지 못했습니다. 이메일과 비밀번호를 확인해주세요.');
    const data=await api('/api/me');el('user-email').textContent=data.user.email;
    el('login-view').hidden=true;el('workspace').hidden=false;
    el('today-label').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long'}).format(new Date());
    await dashboard();
  }catch(error){await client.auth.signOut({scope:'local'});signedOut();message('login-message',error.message,true);}
  finally{el('login-button').disabled=false;}
});
el('logout-button').addEventListener('click',async()=>{
  signedOut();message('login-message','로그아웃했습니다.');
  const {error}=await client.auth.signOut({scope:'local'});
  if(error)message('login-message','화면에서 로그아웃했습니다. 서버 연결을 확인해주세요.',true);
});
el('reload-button').addEventListener('click',dashboard);
const work=initWorkspace(api,dashboard,message);
try{
  const response=await fetch('/config.json',{cache:'no-store'});const config=await response.json();
  if(config.url!=='https://glscckjmlwvxilzneqdf.supabase.co'||!config.publishableKey?.startsWith('sb_publishable_'))throw new Error('로그인 연결을 준비하고 있습니다.');
  client=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
  client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')signedOut();});
  el('login-button').disabled=false;message('login-message','');
}catch(error){message('login-message',error.message,true);}

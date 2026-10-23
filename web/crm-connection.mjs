import {createClient} from '@supabase/supabase-js';
export function crmRequestTimeout(path,method,body){return path==='/api/followups'&&method==='POST'&&['reconcile','choose'].includes(body?.operation)?120000:15000;}
export function initCRMConnection({onConnected,onDisconnected,fetcher=fetch,clientFactory=createClient,remember=false,storage=globalThis.localStorage}){
 const el=id=>document.getElementById(id);let client=null,epoch=0,connected=false,cloudMemos=false;
 // "이 PC에서 로그인 유지": the session lives in this browser's storage only when the user ticks it; otherwise memory only.
 const FLAG='sp-sales-crm-remember',memory=new Map(),safe=f=>{try{return f();}catch{return null;}};
 const remembered=()=>remember&&safe(()=>storage?.getItem(FLAG))==='1';
 const forget=()=>safe(()=>storage?.removeItem(FLAG));
 const authStorage={getItem:k=>remembered()?safe(()=>storage.getItem(k)):(memory.has(k)?memory.get(k):null),setItem:(k,v)=>{if(remembered()&&safe(()=>(storage.setItem(k,v),true)))return;memory.set(k,v);},removeItem:k=>{memory.delete(k);safe(()=>storage?.removeItem(k));}};
 const dialog=document.createElement('dialog');dialog.className='crm-login-dialog';dialog.setAttribute('aria-label','CRM 계정 연결');
 const title=document.createElement('h2');title.textContent='CRM 계정 연결';const hint=document.createElement('p');hint.textContent='저장된 문의와 업무 이력을 확인할 때 기존 업무 계정으로 연결하세요.';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-outline-secondary';cancel.textContent='나중에';cancel.addEventListener('click',()=>{el('password').value='';dialog.close();});
 let keep=null;
 if(remember){const label=document.createElement('label');label.className='remember-login';keep=document.createElement('input');keep.type='checkbox';keep.id='remember-login';const text=document.createElement('span');text.textContent='이 PC에서 로그인 유지 (로그아웃 전까지)';label.append(keep,text);el('login-button').before(label);}
 dialog.append(title,hint,el('login-form'),el('login-message'),cancel);document.body.append(dialog);dialog.addEventListener('cancel',()=>{el('password').value='';});
 const connect=document.createElement('button');connect.id='crm-connect';connect.type='button';connect.className='btn btn-outline-secondary btn-sm';connect.textContent='CRM 계정 연결';el('logout-button').before(connect);
 const show=()=>{if(!dialog.open)dialog.showModal();};connect.addEventListener('click',show);
 const status=(text,error=false)=>{el('login-message').textContent=text;el('login-message').classList.toggle('error',error);};
 function clear(reset=true){epoch++;connected=false;connect.hidden=false;el('logout-button').hidden=true;el('password').value='';if(reset)onDisconnected();}
 async function api(path,method='GET',body){
  const active=epoch;const session=client?(await client.auth.getSession()).data.session:null;
  if(active!==epoch)throw Error('로그인 상태가 변경됐습니다.');
  if(!session){show();throw Error('CRM 계정을 연결하면 저장된 업무를 사용할 수 있습니다.');}
  const response=await fetcher(path.replace(/^\/api\//,'/api/crm/'),{method,headers:{authorization:'Bearer '+session.access_token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(crmRequestTimeout(path,method,body))});
  const data=await response.json();if(active!==epoch)throw Error('로그인 상태가 변경됐습니다.');
  if(!response.ok){if(response.status===403){if(path==='/api/me'){clear();status('계정 접근 권한을 확인하세요.',true);show();}else{try{await api('/api/me');}catch{/* Account denial clears all private views in the nested request. */}}}if(response.status===401){clear();status('로그인이 만료됐습니다. 다시 연결하세요.',true);show();}throw Error(data.error||data.message||'CRM 요청을 확인하지 못했습니다.');}return data;
 }
 el('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!client)return;el('login-button').disabled=true;status('연결하고 있습니다.');const password=el('password').value;el('password').value='';if(remember){if(keep?.checked)safe(()=>storage?.setItem(FLAG,'1'));else forget();}
  try{const {error}=await client.auth.signInWithPassword({email:el('email').value.trim(),password});if(error)throw Error('이메일과 비밀번호를 확인하세요.');const data=await api('/api/me');connected=true;connect.hidden=true;el('logout-button').hidden=false;status('');dialog.close();onConnected(data.user);}
  catch(error){clear(false);await client.auth.signOut({scope:'local'});forget();status(error.message,true);}finally{el('login-button').disabled=false;}
 });
 el('logout-button').addEventListener('click',async()=>{clear();await client?.auth.signOut({scope:'local'});forget();});
 const ready=(async()=>{try{const response=await fetcher('/api/crm/config',{cache:'no-store'}),config=await response.json();if(!response.ok||config.url!=='https://glscckjmlwvxilzneqdf.supabase.co'||!config.publishableKey?.startsWith('sb_publishable_'))throw Error('CRM 연결 설정을 확인해야 합니다.');cloudMemos=config.cloudMemos===true;client=clientFactory(config.url,config.publishableKey,{auth:remember?{persistSession:true,storage:authStorage,storageKey:'sp-sales-crm-auth',autoRefreshToken:true,detectSessionInUrl:false}:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'&&connected)clear();});el('login-button').disabled=false;status('');
  if(remembered()&&(await client.auth.getSession()).data.session){try{const data=await api('/api/me');connected=true;connect.hidden=true;el('logout-button').hidden=false;onConnected(data.user);}catch{clear(false);await client.auth.signOut({scope:'local'});forget();}}
 }catch(error){status(error.message,true);}})();
 return {api,ready,isConnected:()=>connected,cloudMemos:()=>cloudMemos,show};
}

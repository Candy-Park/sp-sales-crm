import {handleApi} from './api.mjs';
import {publicConfig} from './public-config.mjs';
import {memoInput,snapshotInput} from './remote-input.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function body(request,limit=65536){
 const reader=request.body?.getReader();if(!reader)throw Error('input');let size=0,chunks=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('size');}chunks.push(value);}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(data));
}
function memo(row){return {id:row.id,content:row.content,category:row.category,dueDate:row.due_date,completedAt:row.completed_at,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,origin:row.origin||null,homeTask:row.home_task===true};}
export async function handleRemoteApi(request,env,native,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/crm\//,'/api/');
 const invoke=native||((req,e)=>handleApi(req,e,fetcher));
 const query=p=>invoke(new Request(new URL(p,request.url),{headers:request.headers}),env);
 if(path==='/api/config'||url.pathname==='/config.json'){
  if(request.method!=='GET')return reply(405,{error:'지원하지 않는 요청입니다.'});
  const config=publicConfig(env);return reply(config?200:503,config||{error:'CRM 연결 설정을 확인하세요.'});
 }
 if(!['GET','POST','PATCH'].includes(request.method))return reply(405,{error:'지원하지 않는 요청입니다.'});
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply(403,{error:'허용되지 않은 요청입니다.'});
 if(request.method!=='GET'&&(request.headers.get('origin')!==url.origin||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||'')||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'))return reply(403,{error:'현재 CRM에서만 저장할 수 있습니다.'});
 try{
  const auth=await query('/api/me');if(!auth.ok)return auth;const owner=(await auth.json()).user?.id;
  if(!uuid.test(owner||''))return reply(403,{error:'허용된 계정을 확인하세요.'});
  const call=async(route,params={},input)=>{
   const upstream=new URL(route,env.SUPABASE_URL);for(const [k,v] of Object.entries(params))upstream.searchParams.set(k,v);
   const response=await fetcher(upstream.href,{method:input?'POST':'GET',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:request.headers.get('authorization'),...(input?{'content-type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(15000)});
   let data;try{data=await response.json();}catch{throw Error('upstream');}
   if(!response.ok){const e=Error('database');e.status=data.code==='40001'?409:['42501','PGRST301'].includes(data.code)?403:['22023','22007','22008'].includes(data.code)?400:503;throw e;}return data;
  };
  const snapshot=async kind=>{
   const rows=await call('/rest/v1/sales_remote_snapshot',{select:'kind,revision,payload,updated_at',owner_id:'eq.'+owner,kind:'eq.'+kind,limit:'1'});
   if(!Array.isArray(rows))throw Error('upstream');return rows[0]||null;
  };
  const state=async()=>{
   const row=await snapshot('status'),data=row?.payload||{};
   const pending=await call('/rest/v1/sales_remote_command',{select:'id,state',owner_id:'eq.'+owner,state:'in.(queued,running)',order:'created_at.asc',limit:'1'});
   if(!Array.isArray(pending))throw Error('commands');
   const online=!!row&&Date.now()-Date.parse(row.updated_at)<180000;
   return {...data,remote:true,agent_online:online,queued:pending.length>0,ready:!!data.ready&&!pending.length,running:online&&!!data.running,last_synced_at:row?.updated_at||null};
  };
  const memoId=/^\/api\/memos\/([0-9a-f-]+)$/i.exec(path)?.[1];
  if(path==='/api/memos'||memoId){
   if(request.method==='GET'&&path==='/api/memos'){
    const rows=await call('/rest/v1/sales_remote_memo',{select:'*',owner_id:'eq.'+owner,order:'updated_at.desc,id.asc',limit:'1001'});
    if(!Array.isArray(rows)||rows.length>1000)return reply(503,{error:'메모 범위를 확인해야 합니다.'});return reply(200,{memos:rows.map(memo)});
   }
   if(!(request.method==='POST'&&path==='/api/memos'||request.method==='PATCH'&&uuid.test(memoId||'')))return reply(405,{error:'지원하지 않는 메모 요청입니다.'});
   let input;try{input=memoInput(await body(request));}catch{return reply(400,{error:'메모 입력·기한·버전을 확인하세요.'});}
   const result=await call('/rest/v1/rpc/sales_remote_memo_write',{}, {p_request_id:input.requestId,p_memo_id:memoId||null,p_revision:input.revision,p_patch:input.patch});
   return reply(request.method==='POST'?201:200,{memo:result});
  }
  if(path==='/api/remote/snapshot'){
   if(request.method==='GET'){
    const kind=url.searchParams.get('kind');if(!['handling','analysis','status','sources'].includes(kind))return reply(400,{error:'동기화 종류를 확인하세요.'});return reply(200,{state:await snapshot(kind)});
   }
   if(request.method!=='POST')return reply(405,{error:'지원하지 않는 요청입니다.'});
   let input;try{input=snapshotInput(await body(request,524288));}catch{return reply(400,{error:'동기화 자료·버전·크기를 확인하세요.'});}
   return reply(200,{state:await call('/rest/v1/rpc/sales_remote_snapshot_write',{}, {p_request_id:input.requestId,p_kind:input.kind,p_revision:input.revision,p_payload:input.payload})});
  }
  if(path==='/api/followups'){
   if(request.method==='GET'&&url.searchParams.get('view')==='analysis'){
    const saved=await snapshot('analysis'),analysis=saved?.payload||{threads:[],candidates:[],unavailable:true};
    if(!Array.isArray(analysis.threads)||analysis.threads.length>100)throw Error('analysis');
    const ids=[...new Set(analysis.threads.map(t=>t.inquiry_id))];if(ids.some(id=>!uuid.test(id||'')))throw Error('analysis');
    const current=new Map();
    if(ids.length){
     const filter='in.('+ids.join(',')+')';
     const rows=await call('/rest/v1/sales_inquiry',{select:'*',owner_id:'eq.'+owner,id:filter,limit:'101'});
     const actions=await call('/rest/v1/sales_action',{select:'*',owner_id:'eq.'+owner,inquiry_id:filter,limit:'1001'});
     if(!Array.isArray(rows)||!Array.isArray(actions)||actions.length>1000)throw Error('analysis');
     for(const row of rows)current.set(row.id,{inquiry:row,actions:actions.filter(a=>a.inquiry_id===row.id)});
    }
    for(const t of analysis.threads){
     if(!uuid.test(t.inquiry_id||''))throw Error('analysis');
     const data=current.get(t.inquiry_id);if(data?.inquiry?.id!==t.inquiry_id||!Array.isArray(data.actions))throw Error('analysis');
     t.current={...data.inquiry,actions:data.actions,review:t.current?.review};
    }
    return reply(200,{...analysis,last_synced_at:saved?.updated_at||null});
   }
   if(request.method==='GET'&&url.searchParams.get('view')==='sources'){
    const id=url.searchParams.get('inquiry_id'),mid=url.searchParams.get('mail_id');if(!uuid.test(id||'')||mid&&!uuid.test(mid))return reply(400,{error:'원문 연결을 확인하세요.'});
    const response=await query('/api/inquiries/'+id);if(!response.ok)return response;
    const saved=await snapshot('sources');if(!saved)return reply(503,{error:'이 PC 전용 원문은 아직 동기화되지 않았습니다.'});
    const mails=(saved.payload.mails||[]).filter(m=>m.inquiry_id===id&&(!mid||m.id===mid));return reply(200,{mails,hasMore:false});
   }
   if(request.method==='GET')return reply(200,await state());
   if(request.method==='POST'){
    let input;try{input=await body(request);}catch{return reply(400,{error:'메일 확인 요청을 확인하세요.'});}
    if(input.operation==='reconcile'&&Object.keys(input).length===1)return reply(200,{imported:0,recorded:0,remote:true,message:'수집 PC가 확인·저장한 결과를 동기화합니다.'});
    if(!['refresh','choose'].includes(input.operation))return reply(400,{error:'메일 확인 작업을 확인하세요.'});
    if(input.operation==='choose'&&(!/^[0-9a-f]{64}$/.test(input.source_key||'')||!uuid.test(input.customer_id||'')||Object.keys(input).length!==3))return reply(400,{error:'연결 선택을 확인하세요.'});
    if(input.operation==='choose'){const lookup=await query('/api/lookups');if(!lookup.ok)return lookup;if(!(await lookup.json()).customers.some(c=>c.id===input.customer_id))return reply(403,{error:'본인 고객을 선택하세요.'});}
    const command=await call('/rest/v1/rpc/sales_remote_enqueue',{}, {p_request_id:crypto.randomUUID(),p_input:input});
    const status=await state();return reply(202,{...status,ready:false,running:false,queued:true,command_id:command.id});
   }
  }
  if(path==='/api/remote/commands'&&request.method==='POST'){
   let input;try{input=await body(request);}catch{return reply(400,{error:'실행 요청을 확인하세요.'});}
   if(input.operation==='claim'&&Object.keys(input).length===1)return reply(200,{command:await call('/rest/v1/rpc/sales_remote_claim',{}, {})});
   if(input.operation==='complete'&&uuid.test(input.id||'')&&uuid.test(input.lease||'')&&Object.keys(input).length===4)return reply(200,await call('/rest/v1/rpc/sales_remote_complete',{}, {p_id:input.id,p_lease:input.lease,p_result:input.result}));
   return reply(400,{error:'실행 요청을 확인하세요.'});
  }
  if(path==='/api/outlook'&&url.searchParams.get('view')==='reviewed'){
   const saved=await snapshot('handling');if(!saved)return reply(503,{error:'PC의 담당 업무 분류가 아직 동기화되지 않았습니다. 홈과 문의 조회에서 저장된 업무를 확인하세요.'});
   let mails=saved.payload.mails;if(!Array.isArray(mails)||mails.length>1000)throw Error('handling');
   const category=url.searchParams.get('category')||'all';if(!['all','고객 업무','HQ 업무'].includes(category))return reply(400,{error:'업무 구분을 확인하세요.'});
   if(category!=='all')mails=mails.filter(m=>(m.handling?.category||m.category_group)===category);
   const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)return reply(400,{error:'페이지를 확인하세요.'});
   return reply(200,{mails:mails.slice(offset,offset+50),hasMore:mails.length>offset+50,last_synced_at:saved.updated_at});
  }
  if(path==='/api/outlook/local'&&request.method==='GET'){
   const status=await state();return reply(200,{remote:true,total:null,receipted:null,pending:null,held:null,running:false,last_success_at:status.last_synced_at});
  }
  const cloudDetail=request.method==='GET'&&/^\/api\/outlook\/([0-9a-f-]+)$/.exec(path);
  if(cloudDetail){
   const saved=await snapshot('sources'),source=saved?.payload?.mails?.find(m=>m.id===cloudDetail[1]);
   if(source){if(!uuid.test(source.inquiry_id||''))throw Error('source');const owned=await query('/api/inquiries/'+source.inquiry_id);if(!owned.ok)return owned;return reply(200,{mail:source});}
  }
  // Native routes retain existing Auth validation, input checks and owner RLS.
  const target=new URL(request.url);target.pathname=path;
  const result=await invoke(new Request(target,{method:request.method,headers:request.headers,body:request.method==='GET'?undefined:request.body,duplex:request.method==='GET'?undefined:'half'}),env);
  if(path==='/api/outlook'&&url.searchParams.has('inquiry_id')&&result.ok){
   const id=url.searchParams.get('inquiry_id');const owned=await query('/api/inquiries/'+id);if(!owned.ok)return owned;
   const data=await result.json(),saved=await snapshot('sources');
   for(const source of saved?.payload?.mails||[])if(source.inquiry_id===id&&!data.mails.some(m=>m.id===source.id))data.mails.push(source);
   return reply(200,data);
  }
  if(cloudDetail&&result.ok){const saved=await snapshot('handling'),review=saved?.payload?.mails?.find(m=>m.id===cloudDetail[1]);const data=await result.json();
   if(data.mail?.original&&(!review||review.handling?.case_id==='M20-10'||/VPN/i.test(data.mail.subject||'')))data.mail.original={...data.mail.original,body:'담당 분류 미동기화 또는 보호 대상 원문입니다. 보존된 요약 문의를 확인하세요.',attachments:[]};
   return reply(200,data);
  }return result;
 }catch(error){return reply(error.status||503,{error:error.status===409?'저장 버전 또는 요청이 충돌했습니다. 입력을 보관하고 재조회하세요.':error.status===403?'현재 계정의 접근 권한을 확인하세요.':error.status===400?'저장 입력을 확인하세요.':'연결 또는 저장 결과를 확인하지 못했습니다. 입력을 보관하고 같은 요청으로 확인하세요.'});}
}

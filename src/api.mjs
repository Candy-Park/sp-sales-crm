import {id,writeInput} from './write-input.mjs';
import {productQuery,searchProducts,linkInput} from './products.mjs';
import {communicationInput} from './communication.mjs';
import {outlookInput} from './outlook.mjs';
const projectUrl='https://glscckjmlwvxilzneqdf.supabase.co';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(status, body) {
  return Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export async function handleApi(request, env, fetcher=fetch) {
  const path=new URL(request.url).pathname;
  const outlookLink=/^\/api\/outlook\/([0-9a-f-]+)\/link$/i.exec(path);
  const outlookTriage=/^\/api\/outlook\/([0-9a-f-]+)\/triage$/i.exec(path);
  const outlookDetail=/^\/api\/outlook\/([0-9a-f-]+)$/i.exec(path);
  const outlookLocal=path==='/api/outlook/local';
  const detail=/^\/api\/inquiries\/([0-9a-f-]+)$/i.exec(path);
  const addAction=/^\/api\/inquiries\/([0-9a-f-]+)\/actions$/i.exec(path);
  const close=/^\/api\/inquiries\/([0-9a-f-]+)\/close$/i.exec(path);
  const editAction=/^\/api\/actions\/([0-9a-f-]+)$/i.exec(path);
  const productLinks=/^\/api\/inquiries\/([0-9a-f-]+)\/products$/i.exec(path);
  const communication=/^\/api\/inquiries\/([0-9a-f-]+)\/communication$/i.exec(path);
  const messages=/^\/api\/inquiries\/([0-9a-f-]+)\/messages$/i.exec(path);
  const questions=/^\/api\/inquiries\/([0-9a-f-]+)\/questions$/i.exec(path);
  const review=/^\/api\/questions\/([0-9a-f-]+)$/i.exec(path);
  const methods=outlookLink||outlookTriage?['POST']:outlookLocal||path==='/api/outlook'?['GET','POST']:productLinks?['GET','POST']:detail?['GET','PATCH']:addAction||close||messages||questions?['POST']:editAction||review||path==='/api/parties'?['PATCH']:path==='/api/inquiries'?['GET','POST']:['GET'];
  if(!methods.includes(request.method)) return reply(405,{error:'지원하지 않는 요청입니다.'});
  if(!['/api/me','/api/dashboard','/api/lookups','/api/inquiries','/api/parties','/api/products','/api/outlook'].includes(path)&&!detail&&!addAction&&!close&&!editAction&&!productLinks&&!communication&&!messages&&!questions&&!review&&!outlookLink&&!outlookTriage&&!outlookDetail&&!outlookLocal) return reply(404,{error:'요청한 기능이 없습니다.'});
  for(const match of [detail,addAction,close,editAction,productLinks,communication,messages,questions,review,outlookLink,outlookTriage,outlookDetail])if(match){try{id(match[1]);}catch{return reply(400,{error:'항목 식별자를 확인해주세요.'});}}
  if(env.SUPABASE_URL!==projectUrl || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY ?? ''))
    return reply(503,{error:'CRM 연결 설정을 확인해야 합니다.'});
  const authorization=request.headers.get('authorization') ?? '';
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length>8192)
    return reply(401,{error:'로그인이 필요합니다.'});
  const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization};
  const call=async (route,params={},body)=>{
    const url=new URL(route,projectUrl);
    for(const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
    return fetcher(url.href,{method:body?'POST':'GET',headers:body?{...headers,'content-type':'application/json'}:headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  };
  try {
    // Auth server validation; never authorize from unverified JWT decoding or user_metadata.
    const auth=await call('/auth/v1/user');
    if([401,403].includes(auth.status)) return reply(401,{error:'로그인이 만료됐습니다. 다시 로그인해주세요.'});
    if(!auth.ok) return reply(503,{error:'로그인 확인에 실패했습니다. 잠시 후 다시 시도해주세요.'});
    const user=await auth.json();
    if(!uuid.test(user.id ?? '') || user.is_anonymous===true) return reply(403,{error:'허용된 계정으로 로그인해주세요.'});
    const access=await call('/rest/v1/sales_access',{select:'user_id,enabled',user_id:'eq.'+user.id,enabled:'eq.true'});
    if(!access.ok) return reply(503,{error:'접근 권한을 확인할 수 없습니다.'});
    const rows=await access.json();
    if(!Array.isArray(rows) || !rows.some(row=>row.user_id===user.id && row.enabled===true))
      return reply(403,{error:'이 계정은 CRM 사용이 허용되지 않았습니다.'});
    if(path==='/api/me') return reply(200,{user:{id:user.id,email:user.email},allowed:true});
    if(outlookLocal){
      if(!env.localOutlook)return reply(503,{error:'로컬 PC 수집 연결이 필요합니다.'});
      return reply(200,await env.localOutlook(request.method,user.id,authorization));
    }
    const read=async (table,select,extra={})=>{
      const response=await call('/rest/v1/'+table,{select,owner_id:'eq.'+user.id,...extra});
      if(!response.ok) throw new Error('read failed');
      const data=await response.json();if(!Array.isArray(data)) throw new Error('invalid response');
      return data;
    };
    if(request.method!=='GET'){
      let body;
      try{
        if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON 입력이 필요합니다.');
        const raw=await request.text();if(raw.length>700000)throw new Error('입력 내용이 너무 큽니다.');body=JSON.parse(raw);
      }catch{return reply(400,{error:'입력 형식과 크기를 확인해주세요.'});}
      const operation=outlookTriage?'outlook-triage':outlookLink?'outlook-link':path==='/api/outlook'?'outlook-ingest':messages?'message':questions?'question':review?'review':productLinks?'product-link':path==='/api/inquiries'?'register':addAction?'action':editAction?'action-edit':close?'close':detail?'inquiry-edit':'party';
      let data;try{data=operation.startsWith('outlook-')?outlookInput(operation,body):messages||questions||review?communicationInput(operation,body):productLinks?linkInput(body):writeInput(operation,body);}catch(error){return reply(400,{error:error.message});}
      const rpc={'outlook-triage':'sales_triage_outlook','outlook-ingest':'sales_ingest_outlook','outlook-link':'sales_link_outlook',register:'sales_register_inquiry',action:'sales_add_action','action-edit':'sales_edit_action',close:'sales_close_inquiry','inquiry-edit':'sales_edit_inquiry',party:'sales_edit_party','product-link':'sales_link_product',message:'sales_record_message',question:'sales_add_hq_question',review:'sales_review_hq_question'}[operation];
      const params={p_data:data};if(addAction)params.p_inquiry_id=addAction[1];if(editAction||close||detail)params.p_id=(editAction||close||detail)[1];
      if(outlookLink||outlookTriage)params.p_id=(outlookLink||outlookTriage)[1];
      if(productLinks)params.p_inquiry_id=productLinks[1];
      if(messages||questions)params.p_inquiry_id=(messages||questions)[1];
      if(review)params.p_id=review[1];
      const response=await call('/rest/v1/rpc/'+rpc,{},params);
      if(!response.ok){
        const failure=await response.json().catch(()=>({}));
        if(['40001','40P01'].includes(failure.code))return reply(409,{error:'저장된 내용이 변경됐거나 처리 결과 확인이 필요합니다. 입력을 유지한 채 재조회해주세요.'});
        if(['23514','23503','23502','22P02'].includes(failure.code)&&operation==='outlook-triage')return reply(422,{error:'연결된 메일은 업무에서 제외할 수 없습니다. 현재 메일 상태를 재조회해주세요.'});
        if(['23514','23503','23502','23505','22007','22008','22P02'].includes(failure.code))return reply(422,{error:failure.code==='23505'?'같은 고객사가 있습니다. 재조회 후 기존 고객사를 선택해주세요.':'필수 항목, 연결 관계, 실제 발송 기록, 미답변 HQ 질문, 취소 사유 또는 미완료 필수 Action을 확인해주세요. 종료된 문의와 완료·취소 Action은 수정할 수 없습니다.'});
        if(failure.code==='42501')return reply(403,{error:'쓰기 권한이 아직 적용되지 않았거나 이 항목에 접근할 수 없습니다.'});
        return reply(503,{error:'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다. 재조회 후 같은 요청으로 다시 시도해주세요.'});
      }
      return reply(200,{result:await response.json()});
    }
    if(path==='/api/outlook'||outlookDetail){
      const query=new URL(request.url).searchParams;
      const offset=query.get('offset')??'0';
      if(!/^\d{1,7}$/.test(offset))return reply(400,{error:'페이지를 확인해주세요.'});
      const filter={};if(query.has('inquiry_id')){try{filter.inquiry_id='eq.'+id(query.get('inquiry_id'));}catch{return reply(400,{error:'문의 식별자를 확인해주세요.'});}}
      if(!outlookDetail){const view=query.get('view')??'active';if(!['active','excluded','all'].includes(view))return reply(400,{error:'메일 목록을 확인해주세요.'});if(view!=='all')filter.excluded='eq.'+(view==='excluded');}
      const mails=await read('sales_outlook_mail',outlookDetail?'*':'id,direction,subject,occurred_at,state,inquiry_id,body_length,created_at,excluded,triage_revision',{...filter,order:'occurred_at.desc,id.asc',limit:outlookDetail?'1':'51',...(outlookDetail?{id:'eq.'+outlookDetail[1]}:{offset})});
      if(outlookDetail&&!mails.length)return reply(404,{error:'메일을 찾을 수 없습니다.'});
      return reply(200,outlookDetail?{mail:mails[0]}:{mails:mails.slice(0,50),hasMore:mails.length>50});
    }
    if(communication){
      // PostgREST's server cap may return 1000 even when limit=1001 was requested.
      // Probe the next row rather than treating a capped response as complete.
      const history=async(table,order)=>{
        const filter={inquiry_id:'eq.'+communication[1],order,limit:'1001'};
        const rows=await read(table,'*',filter);
        if(rows.length===1000)rows.push(...await read(table,'*',{...filter,offset:'1000',limit:'1'}));
        return rows;
      };
      const [messages,questions,reviews]=await Promise.all([
        history('sales_message','created_at.desc,id.desc'),
        history('sales_hq_question','created_at.asc,id.asc'),
        history('sales_hq_review','revision.desc,created_at.desc,id.desc')]);
      const latest=new Map();for(const r of reviews)if(!latest.has(r.question_id)||latest.get(r.question_id).revision<r.revision)latest.set(r.question_id,r);
      return reply(200,{messages:messages.slice(0,1000),questions:questions.slice(0,1000).map(q=>({...q,revision:latest.get(q.id)?.revision??1,status:latest.get(q.id)?.status??'open',note:latest.get(q.id)?.note??'',response_message_id:latest.get(q.id)?.response_message_id??null})),reviews:reviews.slice(0,1000),truncated:messages.length>1000||questions.length>1000||reviews.length>1000});
    }
    if(path==='/api/products'){
      let query;try{query=productQuery(new URL(request.url).searchParams);}catch(error){return reply(400,{error:error.message});}
      const rows=await read('sales_product','id,spec,batch_id,source_sha256,reviewed_on',{order:'pn.asc',limit:'1001',enabled:'eq.true'});
      if(rows.length>1000)return reply(503,{error:'제품 범위가 1,000개를 넘었습니다. 검색 범위를 조정해야 합니다.'});
      return reply(200,{products:searchProducts(rows.map(r=>({...r.spec,id:r.id,batch_id:r.batch_id,source_sha256:r.source_sha256,reviewed_on:r.reviewed_on})),query),catalogCount:rows.length});
    }
    if(productLinks){
      const links=await read('sales_inquiry_product','*',{inquiry_id:'eq.'+productLinks[1],order:'created_at.desc,id.desc',limit:'1001'});
      return reply(200,{links:links.slice(0,1000),truncated:links.length>1000});
    }
    if(path==='/api/lookups'){
      const [customers,contacts,projects]=await Promise.all([
        read('sales_customer','id,name,updated_at',{order:'name.asc',limit:'1001'}),
        read('sales_contact','id,customer_id,name,contact_note,updated_at',{order:'name.asc',limit:'1001'}),
        read('sales_project','id,customer_id,name,description,updated_at',{order:'name.asc',limit:'1001'})]);
      return reply(200,{customers:customers.slice(0,1000),contacts:contacts.slice(0,1000),projects:projects.slice(0,1000),truncated:[customers,contacts,projects].some(a=>a.length>1000)});
    }
    if(path==='/api/inquiries'){
      const query=new URL(request.url).searchParams;const filters={order:'received_at.desc,id.asc',limit:'101'};
      for(const key of ['customer_id','project_id'])if(query.has(key)){try{filters[key]='eq.'+id(query.get(key));}catch{return reply(400,{error:'조회 조건을 확인해주세요.'});}}
      const offset=query.get('offset')??'0';if(!/^\d{1,7}$/.test(offset))return reply(400,{error:'페이지를 확인해주세요.'});filters.offset=offset;
      const inquiries=await read('sales_inquiry','id,customer_id,project_id,title,status,next_action,received_at',filters);
      return reply(200,{inquiries:inquiries.slice(0,100),hasMore:inquiries.length>100});
    }
    if(detail){
      const inquiries=await read('sales_inquiry','*',{id:'eq.'+detail[1],limit:'1'});
      if(!inquiries.length)return reply(404,{error:'문의를 찾을 수 없습니다.'});
      // Pagination prevents a long history being silently discarded.
      const actions=[];let offset=0;
      for(;;){const page=await read('sales_action','*',{inquiry_id:'eq.'+detail[1],order:'created_at.asc,id.asc',limit:'500',offset:String(offset)});actions.push(...page);if(page.length<500)break;offset+=500;if(offset>=10000)throw new Error('Action history too large');}
      return reply(200,{inquiry:inquiries[0],actions});
    }
    const [actions,inquiries]=await Promise.all([
      read('sales_action','id,inquiry_id,kind,description,due_date,status,mandatory,sales_inquiry!inner(status)',{status:'eq.open','sales_inquiry.status':'neq.closed',order:'due_date.asc.nullslast',limit:'101'}),
      read('sales_inquiry','id,title,status,next_action,received_at,waiting_target,waiting_since',{status:'neq.closed',order:'received_at.desc',limit:'101'})
    ]);
    return reply(200,{actions:actions.slice(0,100),inquiries:inquiries.slice(0,100),truncated:actions.length>100 || inquiries.length>100});
  } catch {
    return reply(503,{error:request.method==='GET'?'CRM 데이터를 불러오지 못했습니다. 다시 시도해주세요.':'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다. 재조회 후 같은 요청으로 다시 시도해주세요.'});
  }
}

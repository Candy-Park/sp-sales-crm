const projectUrl='https://glscckjmlwvxilzneqdf.supabase.co';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(status, body) {
  return Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export async function handleApi(request, env, fetcher=fetch) {
  if(request.method!=='GET') return reply(405,{error:'지원하지 않는 요청입니다.'});
  const path=new URL(request.url).pathname;
  if(!['/api/me','/api/dashboard'].includes(path)) return reply(404,{error:'요청한 기능이 없습니다.'});
  if(env.SUPABASE_URL!==projectUrl || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY ?? ''))
    return reply(503,{error:'CRM 연결 설정을 확인해야 합니다.'});
  const authorization=request.headers.get('authorization') ?? '';
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length>8192)
    return reply(401,{error:'로그인이 필요합니다.'});
  const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization};
  const call=async (route,params={})=>{
    const url=new URL(route,projectUrl);
    for(const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
    return fetcher(url.href,{headers,signal:AbortSignal.timeout(10000)});
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
    const read=async (table,select,extra={})=>{
      const response=await call('/rest/v1/'+table,{select,owner_id:'eq.'+user.id,...extra});
      if(!response.ok) throw new Error('read failed');
      const data=await response.json();if(!Array.isArray(data)) throw new Error('invalid response');
      return data;
    };
    const [actions,inquiries]=await Promise.all([
      read('sales_action','id,inquiry_id,kind,description,due_date,status,mandatory',{status:'eq.open',order:'due_date.asc.nullslast',limit:'101'}),
      read('sales_inquiry','id,title,status,next_action,received_at',{status:'neq.closed',order:'received_at.desc',limit:'101'})
    ]);
    return reply(200,{actions:actions.slice(0,100),inquiries:inquiries.slice(0,100),truncated:actions.length>100 || inquiries.length>100});
  } catch {
    return reply(503,{error:'CRM 데이터를 불러오지 못했습니다. 다시 시도해주세요.'});
  }
}

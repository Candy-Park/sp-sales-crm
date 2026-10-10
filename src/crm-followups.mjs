// Same authenticated APIs as saved inquiries; no credential leaves the server.
export async function handleFollowups(request,env,handler){
 const fail=(status,message)=>Response.json({error:message},{status});
 if(!['GET','POST'].includes(request.method))return fail(405,'지원하지 않는 요청입니다.');
 if(typeof env.localFollowups!=='function'||typeof env.localHandling!=='function')return fail(503,'이 PC의 메일 확인 연결이 필요합니다.');
 if(request.method==='POST'){
  let body;try{body=await request.json();}catch{return fail(400,'메일 확인 입력을 확인하세요.');}
  if(Object.keys(body??{}).join(',')!=='operation'||body.operation!=='refresh')return fail(400,'메일 확인 작업을 확인하세요.');
 }
 const query=path=>handler(new Request(new URL(path,request.url),{headers:request.headers}),env);
 try{
  const me=await query('/api/me');if(!me.ok)return me;
  const owner=(await me.json()).user.id;
  const reviewed=await query('/api/outlook?view=reviewed');if(!reviewed.ok)return reviewed;
  const list=await reviewed.json();if(list.hasMore||!Array.isArray(list.mails))return fail(503,'검토 범위가 완전하지 않습니다.');
  const receipts=new Map((await env.localHandling(owner)).map(row=>[row.id,row]));
  const linked=list.mails.filter(m=>m.handling?.include&&m.handling.case_id!=='M20-10'&&!m.excluded&&m.state==='linked'&&m.inquiry_id);
  if(!linked.length)return fail(422,'먼저 담당 메일을 문의에 연결하세요.');
  const targets=await Promise.all(linked.map(async mail=>{
   const receipt=receipts.get(mail.id);if(!receipt)throw Error('Receipt missing');
   const response=await query('/api/inquiries/'+mail.inquiry_id);if(!response.ok)throw Error('Inquiry unavailable');
   const data=await response.json();if(data.inquiry.id!==mail.inquiry_id)throw Error('Inquiry mismatch');
   const stamps=[data.inquiry.updated_at,...data.actions.map(a=>a.updated_at)].filter(Boolean).map(v=>new Date(v));
   if(!stamps.length||stamps.some(d=>!Number.isFinite(+d)))throw Error('Review time missing');
   return {id:mail.id,scope_key:receipt.scope_key,source_key:receipt.source_key,payload_hash:receipt.payload_hash,inquiry_id:mail.inquiry_id,category:mail.handling.category,reviewed_at:new Date(Math.max(...stamps)).toISOString()};
  }));
  const result=await env.localFollowups({mode:request.method==='POST'?'refresh':'status',owner,targets});
  return Response.json(result,{status:request.method==='POST'?202:200});
 }catch{return fail(503,'메일 확인을 준비하지 못했습니다. 기존 업무는 유지했습니다.');}
}

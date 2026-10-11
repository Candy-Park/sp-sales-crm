import {reconcileRequests,reconcileEvents} from './crm-mail-import.mjs';
// Same authenticated APIs as saved inquiries; no credential leaves the server.
export async function handleFollowups(request,env,handler){
 const fail=(status,message)=>Response.json({error:message},{status});
 if(!['GET','POST'].includes(request.method))return fail(405,'지원하지 않는 요청입니다.');
 if(typeof env.localFollowups!=='function'||typeof env.localHandling!=='function')return fail(503,'이 PC의 메일 확인 연결이 필요합니다.');
 let operation,input;
 if(request.method==='POST'){
  let body;try{body=await request.json();}catch{return fail(400,'메일 확인 입력을 확인하세요.');}
  const choose=body?.operation==='choose';
  if(choose?Object.keys(body).sort().join(',')!=='customer_id,operation,source_key'||!/^[0-9a-f]{64}$/.test(body.source_key)||!/^[0-9a-f-]{36}$/i.test(body.customer_id):Object.keys(body??{}).join(',')!=='operation'||!['refresh','reconcile'].includes(body.operation))return fail(400,'메일 확인 작업을 확인하세요.');
  operation=body.operation;
  input=body;
 }
 const query=path=>handler(new Request(new URL(path,request.url),{headers:request.headers}),env);
 const analysis=request.method==='GET'&&new URL(request.url).searchParams.get('view')==='analysis';
 try{
  const me=await query('/api/me');if(!me.ok)return me;
  const owner=(await me.json()).user.id;
  const reviewed=await query('/api/outlook?view=reviewed');if(!reviewed.ok)return reviewed;
  const list=await reviewed.json();if(list.hasMore||!Array.isArray(list.mails))return fail(503,'검토 범위가 완전하지 않습니다.');
  const receipts=new Map((await env.localHandling(owner)).map(row=>[row.id,row]));
  const linked=list.mails.filter(m=>m.handling?.include&&m.handling.case_id!=='M20-10'&&!m.excluded&&m.state==='linked'&&m.inquiry_id);
  if(!linked.length)return fail(422,'먼저 담당 메일을 문의에 연결하세요.');
  const current=new Map();
  const targets=await Promise.all(linked.map(async mail=>{
   const receipt=receipts.get(mail.id);if(!receipt)throw Error('Receipt missing');
   const response=await query('/api/inquiries/'+mail.inquiry_id);if(!response.ok)throw Error('Inquiry unavailable');
   const data=await response.json();if(data.inquiry.id!==mail.inquiry_id)throw Error('Inquiry mismatch');
   current.set(mail.id,{title:data.inquiry.title,status:data.inquiry.status,next_action:data.inquiry.next_action,review:env.localWorkReview?.(mail.id),actions:data.actions.map(a=>({id:a.id,description:a.description,status:a.status,due_date:a.due_date,kind:a.kind,waiting_target:a.waiting_target,waiting_since:a.waiting_since}))});
   const stamps=[data.inquiry.updated_at,...data.actions.map(a=>a.updated_at)].filter(Boolean).map(v=>new Date(v));
   if(!stamps.length||stamps.some(d=>!Number.isFinite(+d)))throw Error('Review time missing');
   return {id:mail.id,scope_key:receipt.scope_key,source_key:receipt.source_key,payload_hash:receipt.payload_hash,inquiry_id:mail.inquiry_id,category:mail.handling.category,reviewed_at:new Date(Math.max(...stamps)).toISOString()};
  }));
  const sourceQuery=new URL(request.url).searchParams;
  if(request.method==='GET'&&sourceQuery.get('view')==='sources'){
   const iid=sourceQuery.get('inquiry_id'),mid=sourceQuery.get('mail_id');
   if(!/^[0-9a-f-]{36}$/i.test(iid??'')||mid&&!/^[0-9a-f-]{36}$/i.test(mid))return fail(400,'원문 연결을 확인하세요.');
   const response=await query('/api/inquiries/'+iid);if(!response.ok)return response;
   if((await response.json()).inquiry.id!==iid||typeof env.localDiscovery!=='function')return fail(503,'원문 연결을 확인하지 못했습니다.');
   return Response.json(await env.localDiscovery({mode:'sources',owner,targets,inquiry_id:iid,mail_id:mid}));
  }
  let result=await env.localFollowups({mode:analysis||['reconcile','choose'].includes(operation)?'analysis':request.method==='POST'?'refresh':'status',owner,targets});
  if(['reconcile','choose'].includes(operation)){
   if(typeof env.localDiscovery!=='function')return fail(503,'새 요청 저장 연결이 필요합니다.');
   if(operation==='choose'){
    const candidate=result.candidates?.find(c=>c.source_key===input.source_key&&!c.inquiry_id&&!c.automatic_registration);
    if(!candidate)return fail(409,'선택할 새 요청을 다시 확인하세요.');
    const response=await query('/api/lookups');if(!response.ok)return response;
    const lookups=await response.json();if(!lookups.customers?.some(c=>c.id===input.customer_id))return fail(403,'현재 계정의 고객/업무 항목을 선택하세요.');
    await env.localDiscovery({mode:'choose',owner,targets,source_key:input.source_key,customer_id:input.customer_id});
    result=await env.localFollowups({mode:'analysis',owner,targets});
   }
   const write=(path,body)=>handler(new Request(new URL(path,request.url),{method:'POST',headers:request.headers,body:JSON.stringify(body)}),env);
   const saved=await reconcileRequests(result,{owner,targets},env.localDiscovery,write);
   if(!saved.incomplete){
    const cutoffs=Object.fromEntries(targets.filter(t=>current.get(t.id)?.review?.reviewed_on).map(t=>[t.id,current.get(t.id).review.reviewed_on+'T00:00:00+09:00']));
    const events=await env.localDiscovery({mode:'events',owner,targets,cutoffs});
    const history=await reconcileEvents(events,query,write);Object.assign(saved,{recorded:history.recorded,held:history.held,incomplete:history.incomplete,message:history.message,history_remaining:history.remaining});
   }
   return Response.json(saved,{status:saved.incomplete?409:200});
  }
  if(analysis){for(const thread of result.threads){
   if(!current.has(thread.mail_id)||!targets.some(t=>t.id===thread.mail_id&&t.inquiry_id===thread.inquiry_id))throw Error('Unexpected analysis');thread.current=current.get(thread.mail_id);
   const review=thread.current.review,latest=thread.timeline.at(-1)?.occurred_at;
   if(review?.reviewed_on&&latest&&new Date(latest)<new Date(review.reviewed_on+'T00:00:00+09:00')){
    thread.confirmed_review=true;
    thread.proposal={...thread.proposal,stage:'확정한 업무 유지',next_action:thread.current.next_action||review.next_action,auto_apply:false};
   }
   else if(latest){
    const last=thread.timeline.at(-1),received=last.direction==='received'&&!last.held;
    const action=received&&thread.proposal?.stage==='요청 후보';
    thread.observation={bucket:action?'action':'decision',evidence_count:thread.timeline.length,
     next_action:last.held?'표시를 보류한 새 메일: 안전한 원문 확인 필요':action?thread.proposal.next_action:
      last.direction==='sent'?'발신 기록 확인: 고객 회신인지 HQ 문의인지, 미답변 질문이 남았는지 확인':
      '새 답변 수신: 질문별 답변과 고객에게 전달할 내용을 확인',native_status_changed:false};
   }
  }
  for(const thread of result.imported_threads||[]){
   const response=await query('/api/inquiries/'+thread.inquiry_id);if(!response.ok)throw Error('Imported inquiry unavailable');
   const data=await response.json();if(data.inquiry.id!==thread.inquiry_id)throw Error('Imported inquiry mismatch');
   thread.current={...data.inquiry,actions:data.actions,review:{task_owner:'Candy',task_bucket:'action'}};
   thread.confirmed_review=false;
   const last=thread.timeline.at(-1);
   thread.observation={bucket:!last?.held&&last?.direction==='received'&&thread.proposal?.stage==='요청 후보'?'action':'decision',next_action:last?.held?'표시 보류한 후속 메일 확인':thread.proposal?.next_action||'후속 메일 확인'};
   result.threads.push(thread);
  }
  if(typeof env.localDiscovery==='function'){
   const cutoffs=Object.fromEntries(targets.filter(t=>current.get(t.id)?.review?.reviewed_on).map(t=>[t.id,current.get(t.id).review.reviewed_on+'T00:00:00+09:00']));
   const facts=await env.localDiscovery({mode:'events',owner,targets,cutoffs});
   const kinds=new Map(facts.events.map(e=>[e.inquiry_id+':'+e.source_key,e.message.kind]));
   for(const thread of result.threads){
    const last=thread.timeline.at(-1),kind=kinds.get(thread.inquiry_id+':'+last?.source_key);
    if(!thread.confirmed_review&&!last?.held&&['hq_sent','customer_sent'].includes(kind))thread.observation={bucket:'waiting',next_action:kind==='hq_sent'?'HQ에 문의한 메일 확인: HQ 답변을 기다리고 기한을 추적':'고객 회신 메일 확인: 고객 피드백을 기다리고 남은 질문을 확인',native_status_changed:false};
   }
   result.history_held=facts.held;
  }
  }
  else if(Array.isArray(result.updates)){
   result.updates=result.updates.map(row=>{
    const review=current.get(row.mail_id)?.review;
    if(review?.reviewed_on&&row.latest_at&&new Date(row.latest_at)<new Date(review.reviewed_on+'T00:00:00+09:00')){
     return {...row,reviewed_followups:{received:row.later_received,sent:row.later_sent},later_received:0,later_sent:0};
    }
    return row;
   });
  }
  return Response.json(result,{status:request.method==='POST'?202:200});
 }catch{return fail(503,'메일 확인을 준비하지 못했습니다. 기존 업무는 유지했습니다.');}
}

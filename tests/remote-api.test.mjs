import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRemoteApi} from '../src/remote-api.mjs';
const owner='00000000-0000-4000-8000-000000000001',iid='00000000-0000-4000-8000-000000000002';
const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
const req=(path,method='GET',body,extra={})=>new Request('https://crm.example.test/api/crm/'+path,{method,headers:{authorization:'Bearer synthetic','content-type':'application/json',origin:'https://crm.example.test',...extra},body:body?JSON.stringify(body):undefined});
function native({auth=200}={}){return async request=>{const p=new URL(request.url).pathname;if(p==='/api/me')return Response.json(auth===200?{user:{id:owner}}:{error:'expired'},{status:auth});if(p==='/api/inquiries/'+iid)return Response.json({inquiry:{id:iid,title:'Saved current',next_action:'New saved action',status:'new'},actions:[{id:iid,status:'open',due_date:'2026-10-20'}]});return Response.json({native:true});};}
test('remote private routes deny expired sessions and cross origin writes before reading private state',async()=>{
 let calls=0;const read=async()=>{calls++;return Response.json([]);};
 const denied=await handleRemoteApi(req('followups?view=analysis'),env,native({auth:401}),read);assert.equal(denied.status,401);assert.equal(calls,0);
 const cross=await handleRemoteApi(req('memos','POST',{requestId:iid,input:{content:'x',category:'work',dueDate:null}},{origin:'https://other.example'}),env,native(),read);assert.equal(cross.status,403);assert.equal(calls,0);
});
test('cloud analysis refreshes saved Action and status rather than trusting old PC state',async()=>{
 const fetcher=async url=>{const u=new URL(url);assert.equal(u.searchParams.get('owner_id'),'eq.'+owner);if(u.pathname.endsWith('sales_inquiry'))return Response.json([{id:iid,title:'Saved current',status:'new'}]);if(u.pathname.endsWith('sales_action'))return Response.json([{id:iid,inquiry_id:iid,status:'open',due_date:'2026-10-20'}]);return Response.json([{kind:'analysis',revision:1,updated_at:'2026-10-13T00:00:00Z',payload:{threads:[{inquiry_id:iid,mail_id:iid,current:{title:'Old',status:'closed',review:{task_owner:'Candy'}},timeline:[]}],candidates:[]}}]);};
 const res=await handleRemoteApi(req('followups?view=analysis'),env,native(),fetcher);assert.equal(res.status,200);const data=await res.json();assert.equal(data.threads[0].current.title,'Saved current');assert.equal(data.threads[0].current.actions[0].due_date,'2026-10-20');assert.equal(data.threads[0].current.review.task_owner,'Candy');
});
test('offline PC never reports a queued refresh as a successful mail scan',async()=>{
 const fetcher=async url=>new URL(url).pathname.includes('/rpc/')?Response.json({id:iid,status:'pending'}):Response.json([]);
 const res=await handleRemoteApi(req('followups','POST',{operation:'refresh'}),env,native(),fetcher);const data=await res.json();assert.equal(res.status,202);assert.equal(data.ready,false);assert.equal(data.queued,true);assert.equal(data.agent_online,false);
});
test('memo requests use owned RPC parameters, preserve uncertain saves and reject forged owners',async()=>{
 let body;const fetcher=async(url,init)=>{body=JSON.parse(init.body);return Response.json({id:iid,revision:1,content:'synthetic'});};
 const data={requestId:iid,input:{content:'synthetic',category:'work',dueDate:null}};
 const res=await handleRemoteApi(req('memos','POST',data),env,native(),fetcher);assert.equal(res.status,201);assert.equal(body.p_request_id,iid);assert.equal('owner_id'in body,false);
 const bad=await handleRemoteApi(req('memos','POST',{...data,owner_id:owner}),env,native(),fetcher);assert.equal(bad.status,400);
});

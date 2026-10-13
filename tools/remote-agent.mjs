import {handleApi} from '../src/api.mjs';
import {handleFollowups} from '../src/crm-followups.mjs';
import {createSnapshotWriter,agentDue} from '../src/remote-sync.mjs';
export function createRemoteAgent({env,origin,fetcher=fetch,schedule=setTimeout,cancel=clearTimeout,localHandler=null,now=()=>new Date()}){
 let authorization=null,owner=null,timer=null,stopped=false,busy=false,lastHour=null,lastTick=null,sessionEpoch=0,error=null,completed=null,failures=0,pendingConnection=null;
 const cloud=async(path,method='GET',body)=>{
  const active=sessionEpoch;
  const response=await fetcher(new URL(path.replace(/^\/api\//,'/api/crm/'),origin),{method,headers:{authorization,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  if(active!==sessionEpoch)throw Error('Agent account changed');
  const data=await response.json();if(!response.ok){if(response.status===401||response.status===403){authorization=null;stopped=true;}throw Error('Cloud sync unavailable ('+response.status+')');}return data;
 };
 let writer=createSnapshotWriter(cloud);
 const local=async(path,method='GET',body)=>{
  const active=sessionEpoch;
  if(localHandler){const data=await localHandler(path,method,body);if(active!==sessionEpoch)throw Error('Agent account changed');return data;}
  const request=new Request(new URL(path,'http://127.0.0.1:4327'),{method,headers:{authorization,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const result=path.startsWith('/api/followups')?await handleFollowups(request,env,handleApi):await handleApi(request,env);
  if(active!==sessionEpoch)throw Error('Agent account changed');if(!result.ok)throw Error('PC review unavailable ('+result.status+')');return result.json();
 };
 async function mirror(){
  const analysis=await local('/api/followups?view=analysis');
  const handling=await local('/api/outlook?view=reviewed');
  if(handling.hasMore)throw Error('Incomplete reviewed range');
  for(const mail of handling.mails)mail.work_review=env.localWorkReview?.(mail.id);
  const mails=[];
  for(const id of [...new Set(analysis.threads.map(t=>t.inquiry_id))]){
   const sources=await local('/api/followups?view=sources&inquiry_id='+id);
   if(sources.hasMore)throw Error('Incomplete source range');
   for(const mail of sources.mails)if(!mails.some(m=>m.id===mail.id))mails.push(mail);
  }
  await writer.put('handling',{mails:handling.mails.filter(m=>m.handling?.include)});
  await writer.put('sources',{mails});await writer.put('analysis',analysis);
 }
 async function tick(){
  if(stopped||!authorization||busy)return;busy=true;
  try{
   if(completed){await cloud('/api/remote/commands','POST',completed);completed=null;}
   const {command}=await cloud('/api/remote/commands','POST',{operation:'claim'});
   if(command){
    try{await local('/api/followups','POST',command.input);completed={operation:'complete',id:command.id,lease:command.lease,result:{accepted:true}};}
    catch{completed={operation:'complete',id:command.id,lease:command.lease,result:{accepted:false,error:'PC 수집·연결 확인이 필요합니다.'}};}
    await cloud('/api/remote/commands','POST',completed);completed=null;
   }else{const clock=now();if(agentDue(clock,lastHour,lastTick)){lastHour=clock.toISOString().slice(0,13);await local('/api/followups','POST',{operation:'refresh'});}lastTick=clock;}
   const status=await local('/api/followups');
   if(status.ready&&!status.running&&!status.error){const result=await local('/api/followups','POST',{operation:'reconcile'});if(result.incomplete)throw Error('Partial mail save requires same request retry');}
   await mirror();await writer.put('status',{...status,agent_error:null},{heartbeat:true});error=null;failures=0;
  }catch(cause){error=/^(PC review unavailable|Cloud sync unavailable|Incomplete|Partial mail save)/.test(cause.message)?cause.message:'PC 동기화 결과를 확인하지 못했습니다. 기존 자료를 보존합니다.';if(++failures>=3)stopped=true;}
  finally{busy=false;if(pendingConnection){const pending=pendingConnection;pendingConnection=null;connect(pending.value,pending.uid);}else if(!stopped&&authorization)timer=schedule(()=>{timer=null;void tick();},60000-(+now()%60000));}
 }
 function stop(){stopped=true;authorization=null;sessionEpoch++;if(timer)cancel(timer);timer=null;}
 function connect(value,uid){
  if(!origin)return;if(stopped&&failures>=3&&authorization===value)return;const changed=owner&&owner!==uid;
  if(changed&&busy){pendingConnection={value,uid};stop();return;}
  if(changed){sessionEpoch++;writer=createSnapshotWriter(cloud);lastHour=null;lastTick=null;completed=null;}
  owner=uid;authorization=value;stopped=false;failures=0;if(!changed&&(timer||busy))return;if(timer){cancel(timer);timer=null;}if(!busy)void tick();
 }
 return {
  connect,stop,
  status(){return {configured:!!origin,connected:!!authorization&&!stopped,owner,error};},
  tick
 };
}

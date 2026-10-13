import {createHash} from 'node:crypto';
export function agentDue(now,last,previous=null){
 const date=new Date(+now+9*3600000),hour=date.getUTCHours();
 const boundary=Math.floor(+now/3600000)*3600000;
 const reached=date.getUTCMinutes()===0||previous!==null&&+previous<boundary;
 return ![0,6].includes(date.getUTCDay())&&hour>=10&&hour<=18&&reached&&now.toISOString().slice(0,13)!==last;
}
export function createSnapshotWriter(api,uuid=()=>crypto.randomUUID()){
 const states=new Map();
 return {async put(kind,payload,{heartbeat=false}={}){
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');let state=states.get(kind);
  if(!state){const {state:saved}=await api('/api/remote/snapshot?kind='+kind);state={revision:saved?.revision||0,hash:null,pending:null};states.set(kind,state);}
  if(!heartbeat&&state.hash===hash&&!state.pending)return;
  if(!state.pending)state.pending={requestId:uuid(),kind,revision:state.revision,payload};
  // A lost response retries precisely the same payload and request, before newer data.
  const pending=state.pending,result=await api('/api/remote/snapshot','POST',pending);
  state.revision=result.state.revision;state.hash=createHash('sha256').update(JSON.stringify(pending.payload)).digest('hex');state.pending=null;
  if(state.hash!==hash)return this.put(kind,payload,{heartbeat});
 }};
}

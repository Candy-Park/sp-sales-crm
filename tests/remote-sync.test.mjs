import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotWriter,agentDue} from '../src/remote-sync.mjs';
import {createRemoteAgent} from '../tools/remote-agent.mjs';
const id='00000000-0000-4000-8000-000000000001';
test('lost snapshot response repeats identical request and never overwrites a version conflict',async()=>{
 const calls=[];let fail=true;
 const api=async(path,method='GET',body)=>{if(method==='GET')return {state:null};calls.push(body);if(fail){fail=false;throw Error('uncertain');}return {state:{revision:1}};};
 const writer=createSnapshotWriter(api,()=>id);await assert.rejects(writer.put('analysis',{threads:[]}),/uncertain/);
 await writer.put('analysis',{threads:[]});assert.deepEqual(calls[0],calls[1]);
 await writer.put('analysis',{threads:[]});assert.equal(calls.length,2);
});
test('Agent collection is weekday hourly only and a restart between exact hours does not force a scan',()=>{
 for(const [stamp,expected] of [['2026-10-13T10:00:05+09:00',true],['2026-10-13T10:30:00+09:00',false],['2026-10-13T18:00:30+09:00',true],['2026-10-13T18:01:00+09:00',false],['2026-10-17T10:00:01+09:00',false]])assert.equal(agentDue(new Date(stamp),null),expected);
 assert.equal(agentDue(new Date('2026-10-13T10:00:30+09:00'),'2026-10-13T01'),false);
});
test('a delayed PC tick catches an hourly boundary without scanning twice or forcing a mid-hour restart',()=>{
 assert.equal(agentDue(new Date('2026-10-13T10:01:10+09:00'),null,new Date('2026-10-13T09:59:50+09:00')),true);
 assert.equal(agentDue(new Date('2026-10-13T10:01:10+09:00'),'2026-10-13T01',new Date('2026-10-13T09:59:50+09:00')),false);
 assert.equal(agentDue(new Date('2026-10-13T18:01:10+09:00'),null,new Date('2026-10-13T17:59:50+09:00')),true);
 assert.equal(agentDue(new Date('2026-10-13T10:30:00+09:00'),null,null),false);
});
test('an expired scheduled Agent connection restarts with a refreshed token instead of retaining a consumed timer',async()=>{
 let reject=false,claims=0,timers=[];
 const fetcher=async(url,init)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/commands')){claims++;if(reject)return Response.json({error:'expired'},{status:401});return Response.json({command:null});}
  return Response.json(init.method==='POST'?{state:{revision:1}}:{state:null});
 };
 const agent=createRemoteAgent({env:{},origin:'https://crm.example',fetcher,
  localHandler:async path=>path.includes('analysis')?{threads:[],candidates:[]}:path.includes('outlook')?{mails:[],hasMore:false}:{ready:false},
  schedule:fn=>{timers.push(fn);return timers.length;},cancel(){},now:()=>new Date('2026-10-13T22:00:00+09:00')});
 const flush=()=>new Promise(r=>setImmediate(r));
 agent.connect('Bearer SYNTHETIC_ONLY_A',id);await flush();assert.equal(timers.length,1);
 reject=true;timers[0]();await flush();assert.equal(agent.status().connected,false);
 reject=false;agent.connect('Bearer SYNTHETIC_ONLY_B',id);await flush();assert.equal(claims,3);assert.equal(timers.length,2);agent.stop();
});

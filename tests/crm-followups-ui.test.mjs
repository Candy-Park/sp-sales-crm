import test from 'node:test';
import assert from 'node:assert/strict';
import {initFollowups,nextFollowupDelay,followupWindow} from '../web/crm-followups.mjs';
class Element{
 constructor(){this.children=[];this.events={};this.textContent='';this.classList={add(){},remove(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 addEventListener(name,fn){this.events[name]=fn;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('polls existing scan then schedules Seoul hourly check, stops and clears on disconnect',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element(),timers=new Map();let next=0,connected=true,calls=[];
 const data=[{running:true},{ready:true,last_checked_at:'2026-10-10T15:00:00Z',updates:[{mail_id:'m',inquiry_id:'i',later_sent:1,later_received:2}]}];
 const opened=[];
 const panel=initFollowups({root,isConnected:()=>connected,api:async(...args)=>{calls.push(args);return data.shift();},open:id=>opened.push(id),label:()=>'<synthetic>',now:()=>new Date('2026-10-12T10:30:00+09:00'),schedule:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},cancel:id=>timers.delete(id)});
 panel.start();await flush();assert.equal(timers.get(1).ms,4000);await timers.get(1).fn();await flush();assert.equal(timers.get(2).ms,1800000);
 assert.deepEqual(calls.map(c=>c[1]),['GET','GET']);root.children[4].children[0].children[0].events.click();assert.deepEqual(opened,['i']);
 connected=false;panel.stop();assert.equal(timers.size,0);assert.equal(root.children[4].children.length,0);assert.equal(root.children[2].disabled,true);
});
test('Seoul hourly schedule includes 18:00 and skips overnight without host timezone dependence',()=>{
 for(const [stamp,minutes,allowed] of [
  ['2026-10-12T09:59:00+09:00',1,false],['2026-10-12T10:00:00+09:00',60,true],
  ['2026-10-12T17:59:00+09:00',1,true],['2026-10-12T18:00:00+09:00',960,true],
  ['2026-10-12T18:01:00+09:00',959,false],['2026-10-12T23:00:00+09:00',660,false]
 ]){assert.equal(nextFollowupDelay(new Date(stamp)),minutes*60000);assert.equal(followupWindow(new Date(stamp)),allowed);}
});
test('overnight login reads status only, delayed automatic wake does not scan and manual button still scans',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element(),timers=new Map();let next=0,calls=[];
 const panel=initFollowups({root,isConnected:()=>true,api:async(...args)=>{calls.push(args);return {ready:false};},open(){},now:()=>new Date('2026-10-12T23:00:00+09:00'),schedule:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},cancel:id=>timers.delete(id)});
 panel.start();await flush();assert.equal(calls[0][1],'GET');assert.equal(timers.get(1).ms,660*60000);
 await timers.get(1).fn();await flush();assert.equal(calls.length,1);
 root.children[2].events.click();await flush();assert.equal(calls[1][1],'POST');assert.deepEqual(calls[1][2],{operation:'refresh'});panel.stop();
});
test('errors halt retries and late private result cannot reappear after logout',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element();let resolve,scheduled=0;
 const panel=initFollowups({root,isConnected:()=>true,api:()=>new Promise(r=>resolve=r),open(){},schedule:()=>++scheduled,cancel(){}});
 panel.start();panel.stop();resolve({ready:true,last_checked_at:'2026-10-10T15:00:00Z',updates:[{later_sent:1}]});await flush();assert.equal(scheduled,0);assert.equal(root.children[4].children.length,0);
 panel.start();resolve({error:'Synthetic failure'});await flush();assert.equal(scheduled,0);assert.match(root.children[1].textContent,/자동 확인을 중지/);assert.equal(root.children[2].disabled,false);
});


test('weekends skip to Monday and Friday 18:00 stays the last collection',()=>{
 for(const [stamp,minutes,allowed] of [
  ['2026-10-09T18:00:00+09:00',3840,true],['2026-10-10T10:00:00+09:00',2880,false],['2026-10-11T17:00:00+09:00',1020,false]
 ]){assert.equal(nextFollowupDelay(new Date(stamp)),minutes*60000);assert.equal(followupWindow(new Date(stamp)),allowed);}
});
test('Outlook closed skips collection without halting next weekday timer',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element();let delay;
 const panel=initFollowups({root,isConnected:()=>true,api:async()=>({skipped:'outlook_not_running'}),open(){},now:()=>new Date('2026-10-12T11:00:00+09:00'),schedule:(fn,ms)=>{delay=ms;return 1;},cancel(){}});
 panel.start();await flush();assert.equal(delay,3600000);assert.match(root.children[1].textContent,/건너뛰었습니다/);panel.stop();
});
test('reconciliation failure keeps manual retry available and logout during reconciliation never rearms polling',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element();let resume,timers=0;
 const panel=initFollowups({root,isConnected:()=>true,api:async()=>({ready:true,last_checked_at:'2026-10-11T00:00:00Z'}),open(){},onChecked:()=>new Promise(r=>resume=r),schedule:()=>++timers,cancel(){}});
 panel.start();await flush();panel.stop();resume();await flush();assert.equal(timers,0);assert.equal(root.children[2].disabled,true);
 const retryRoot=new Element(),failed=initFollowups({root:retryRoot,isConnected:()=>true,api:async()=>({ready:true,last_checked_at:'2026-10-11T00:00:00Z'}),open(){},onChecked:async()=>{throw Error('Synthetic uncertain save');},schedule:()=>++timers,cancel(){}});
 failed.start();await flush();assert.equal(retryRoot.children[2].disabled,false);assert.match(retryRoot.children[1].textContent,/uncertain save/);assert.equal(timers,0);
});

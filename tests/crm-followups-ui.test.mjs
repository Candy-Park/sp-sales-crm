import test from 'node:test';
import assert from 'node:assert/strict';
import {initFollowups} from '../web/crm-followups.mjs';
class Element{
 constructor(){this.children=[];this.events={};this.textContent='';this.classList={add(){},remove(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 addEventListener(name,fn){this.events[name]=fn;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('polls running scan then schedules five minute scan, stops and clears on disconnect',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element(),timers=new Map();let next=0,connected=true,calls=[];
 const data=[{running:true},{ready:true,last_checked_at:'2026-10-10T15:00:00Z',updates:[{mail_id:'m',inquiry_id:'i',later_sent:1,later_received:2}]}];
 const opened=[];
 const panel=initFollowups({root,isConnected:()=>connected,api:async(...args)=>{calls.push(args);return data.shift();},open:id=>opened.push(id),label:()=>'<synthetic>',schedule:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},cancel:id=>timers.delete(id)});
 panel.start();await flush();assert.equal(timers.get(1).ms,4000);await timers.get(1).fn();await flush();assert.equal(timers.get(2).ms,300000);
 assert.deepEqual(calls.map(c=>c[1]),['POST','GET']);root.children[4].children[0].children[0].events.click();assert.deepEqual(opened,['i']);
 connected=false;panel.stop();assert.equal(timers.size,0);assert.equal(root.children[4].children.length,0);assert.equal(root.children[2].disabled,true);
});
test('errors halt retries and late private result cannot reappear after logout',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element();let resolve,scheduled=0;
 const panel=initFollowups({root,isConnected:()=>true,api:()=>new Promise(r=>resolve=r),open(){},schedule:()=>++scheduled,cancel(){}});
 panel.start();panel.stop();resolve({ready:true,last_checked_at:'2026-10-10T15:00:00Z',updates:[{later_sent:1}]});await flush();assert.equal(scheduled,0);assert.equal(root.children[4].children.length,0);
 panel.start();resolve({error:'Synthetic failure'});await flush();assert.equal(scheduled,0);assert.match(root.children[1].textContent,/자동 확인을 중지/);assert.equal(root.children[2].disabled,false);
});

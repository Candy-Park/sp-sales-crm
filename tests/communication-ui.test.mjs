import test from 'node:test';
import assert from 'node:assert/strict';
import {initCommunication} from '../web/communication.mjs';
class Node{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';this.value='';this.checked=false;this.disabled=false;this.isConnected=true;this.elements=[];}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){for(const n of this.children)n.isConnected=false;this.children=nodes;}
 setAttribute(){}
 addEventListener(name,fn){this.listeners[name]=fn;}
 querySelectorAll(selector){const all=this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);return all.filter(n=>selector==='*'||selector==='button'&&n.tagName==='button'||selector==='input'&&n.tagName==='input'||selector==='input:checked'&&n.tagName==='input'&&n.checked);}
 querySelector(s){return this.querySelectorAll(s)[0];}
 reset(){for(const n of this.elements){n.value=n.defaultValue??'';n.checked=false;}}
}
const ids=['communication-kind','communication-occurrence','communication-time','communication-send-options','communication-confirmed','communication-question-choices','communication-translation-fields','communication-source','communication-action','communication-save','hq-questions','communication-history','communication-reload','communication-copy','communication-reset','hq-question-reset','communication-form','hq-question-form','hq-question-text','communication-body','communication-target','communication-subject','communication-translation','communication-summary','communication-save-status','communication-status','hq-question-status'];
function fixture(){const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));nodes['communication-kind'].value='hq_draft';nodes['communication-kind'].defaultValue='hq_draft';nodes['communication-form'].elements=ids.filter(id=>/^communication-(kind|time|confirmed|source|action|body|target|subject|translation|summary)$/.test(id)).map(id=>nodes[id]);nodes['hq-question-form'].elements=[nodes['hq-question-text']];nodes['hq-question-form'].append(new Node('button'));return {nodes,document:{getElementById:id=>nodes[id],createElement:tag=>new Node(tag)}};}
const empty={messages:[],questions:[],reviews:[],truncated:false};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function setup(f,api,onQuestions=()=>{}){return initCommunication({api,message:(id,t)=>f.nodes[id].textContent=t,refresh:async()=>{},onQuestions});}
test('late history from another inquiry cannot restore private messages or closure state',async()=>{
 const f=fixture(),original=globalThis.document;globalThis.document=f.document;
 try{const pending=[],changes=[];const comm=setup(f,()=>new Promise(resolve=>pending.push(resolve)),(...args)=>changes.push(args));
  comm.bind({id:'A',status:'new'},[]);comm.bind({id:'B',status:'new'},[]);pending[1](empty);await flush();
  pending[0]({...empty,messages:[{kind:'hq_received',body:'PRIVATE A',target:'A',occurred_at:'2026-10-06T00:00:00Z'}]});await flush();
  assert.equal(f.nodes['communication-history'].children.length,1);assert.equal(f.nodes['communication-history'].children[0].textContent,'아직 저장한 초안·발송·답변 기록이 없습니다.');assert.deepEqual(changes.at(-1),['B',0,false]);
 }finally{globalThis.document=original;}
});
test('logout clears communication inputs and ignores pending replies',async()=>{
 const f=fixture(),original=globalThis.document;globalThis.document=f.document;
 try{let complete;const comm=setup(f,()=>new Promise(resolve=>complete=resolve));comm.bind({id:'A',status:'new'},[]);f.nodes['communication-body'].value='PRIVATE';comm.reset();complete({...empty,messages:[{body:'PRIVATE'}]});await flush();assert.equal(f.nodes['communication-body'].value,'');assert.equal(f.nodes['communication-history'].children.length,0);assert.equal(f.nodes['communication-status'].textContent,'');}
 finally{globalThis.document=original;}
});
test('uncertain message save keeps body and request ID for the exact retry',async()=>{
 const f=fixture(),original=globalThis.document;globalThis.document=f.document;
 try{const saves=[];const comm=setup(f,async(path,method,body)=>{if(method){saves.push(body);throw Error('저장 결과를 확인하지 못했습니다.');}return empty;});comm.bind({id:'A',status:'new'},[]);await flush();f.nodes['communication-body'].value='Original <b>100G</b> / 10 km';f.nodes['communication-target'].value='HQ';
  const submit=()=>f.nodes['communication-form'].listeners.submit({preventDefault(){},currentTarget:f.nodes['communication-form']});await submit();await submit();assert.equal(f.nodes['communication-body'].value,saves[0].body);assert.deepEqual(saves[0],saves[1]);assert.equal(saves[0].occurred_at,null);assert.equal(saves[0].actual_confirmed,false);
 }finally{globalThis.document=original;}
});
test('copying a draft invokes no write and does not mark it as sent',async()=>{
 const f=fixture(),original=globalThis.document,nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.document=f.document;
 try{let copied='',writes=0;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>copied=text}}});const comm=setup(f,async(_p,method)=>{if(method)writes++;return empty;});comm.bind({id:'A',status:'new'},[]);await flush();f.nodes['communication-body'].value='Draft';await f.nodes['communication-copy'].listeners.click();assert.equal(copied,'Draft');assert.equal(writes,0);assert.match(f.nodes['communication-save-status'].textContent,/대기 상태는 바뀌지/);}
 finally{globalThis.document=original;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});
test('missing or truncated question history blocks closure rather than assuming no unanswered questions',async()=>{
 const f=fixture(),original=globalThis.document;globalThis.document=f.document;
 try{const changes=[];const comm=setup(f,async()=>({...empty,truncated:true}),(...args)=>changes.push(args));comm.bind({id:'A',status:'new'},[]);await flush();assert.deepEqual(changes.at(-1),['A',0,true]);assert.match(f.nodes['communication-status'].textContent,/종료할 수 없습니다/);
  const failing=setup(f,async()=>{throw Error('Synthetic DB outage');},(...args)=>changes.push(args));failing.bind({id:'B',status:'new'},[]);await flush();assert.deepEqual(changes.at(-1),['B',0,true]);assert.equal(f.nodes['communication-status'].textContent,'Synthetic DB outage');
 }finally{globalThis.document=original;}
});
test('partial answer remains open and receiving a reply does not complete a question',async()=>{
 const f=fixture(),original=globalThis.document;globalThis.document=f.document;
 try{const changes=[];const comm=setup(f,async()=>({...empty,questions:[{id:'Q',question:'Packing?',revision:2,status:'partial',note:'Packing unconfirmed'}]}),(...args)=>changes.push(args));comm.bind({id:'A',status:'new'},[]);await flush();assert.deepEqual(changes.at(-1),['A',1,false]);assert.equal(f.nodes['hq-questions'].children.length,1);}
 finally{globalThis.document=original;}
});

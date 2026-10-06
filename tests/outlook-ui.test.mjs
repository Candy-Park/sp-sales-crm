import test from 'node:test';
import assert from 'node:assert/strict';
import {initOutlook} from '../web/outlook.mjs';
class Node{
 constructor(tag='div'){this.tagName=tag;this.listeners={};this.children=[];this.value='';this.hidden=false;this.textContent='';this.disabled=false;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this.textContent='';}
}
const ids=['outlook-message','outlook-status','outlook-start','outlook-list','outlook-prev','outlook-next','outlook-inquiry','outlook-inquiry-prev','outlook-inquiry-next','outlook-review','outlook-subject','outlook-meta','outlook-body','outlook-link-form','outlook-linked-open','outlook-new-title','outlook-customer','outlook-customer-name','nav-outlook','outlook-reload','outlook-link-save','outlook-link-mode','detail-mails'];
function fixture(){const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));return {nodes,document:{getElementById:id=>nodes[id],createElement:tag=>new Node(tag)}};}
const mail=(id,body='SYNTHETIC <script>原文 😀')=>({id,state:'pending',subject:id,occurred_at:'2026-10-06T12:00:00Z',direction:'received',original:{body,sender:'synthetic@example.test',recipients:'synthetic@example.test',attachments:[]}});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const status={running:false,total:2,pending:2,held:0,receipted:0};
function setup(f,api){return initOutlook({api,message:(id,text)=>f.nodes[id].textContent=text,show(){},open:async()=>{}});}
function base(path){if(path==='/api/outlook/local')return status;if(path==='/api/lookups')return {customers:[]};if(path.startsWith('/api/inquiries'))return {inquiries:[],hasMore:false};return {mails:[mail('A'),mail('B')],hasMore:false};}
test('mail list only reads metadata and never creates inquiries or messages',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const writes=[];setup(f,async(path,method)=>{if(method)writes.push(path);return base(path);});f.nodes['nav-outlook'].listeners.click();await flush();assert.equal(f.nodes['outlook-list'].children.length,2);assert.deepEqual(writes,[]);}finally{globalThis.document=old;}
});
test('logout/reset clears original and prevents a delayed review restoring private mail',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{let resolve;const out=setup(f,async path=>path==='/api/outlook/A'?new Promise(r=>resolve=r):base(path));f.nodes['nav-outlook'].listeners.click();await flush();const pending=f.nodes['outlook-list'].children[0].children[0].listeners.click();out.reset();resolve({mail:mail('A','PRIVATE')});await pending;assert.equal(f.nodes['outlook-body'].textContent,'');assert.equal(f.nodes['outlook-subject'].textContent,'');assert.equal(f.nodes['outlook-review'].hidden,true);}finally{globalThis.document=old;}
});
test('latest selected mail wins when older original arrives later',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const pending={};setup(f,async path=>/^\/api\/outlook\/[AB]$/.test(path)?new Promise(r=>pending[path]=r):base(path));f.nodes['nav-outlook'].listeners.click();await flush();const a=f.nodes['outlook-list'].children[0].children[0].listeners.click(),b=f.nodes['outlook-list'].children[1].children[0].listeners.click();pending['/api/outlook/B']({mail:mail('B','SOURCE B')});await b;pending['/api/outlook/A']({mail:mail('A','SOURCE A')});await a;assert.equal(f.nodes['outlook-body'].textContent,'SOURCE B');assert.equal(f.nodes['outlook-subject'].textContent,'B');}finally{globalThis.document=old;}
});
test('held review has no remote body and hides linking without creating or translating anything',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const calls=[];setup(f,async(path,method)=>{calls.push({path,method});return path==='/api/outlook/A'?{mail:{...mail('A',null),state:'held',body_length:2974731}}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();assert.equal(f.nodes['outlook-link-form'].hidden,true);assert.match(f.nodes['outlook-body'].textContent,/보류/);assert.equal(calls.some(c=>c.method||c.path==='/api/lookups'),false);}finally{globalThis.document=old;}
});
test('uncertain new inquiry link retains original and request identity for exact retry',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const writes=[];setup(f,async(path,method,body)=>{if(method){writes.push(structuredClone(body));throw Error('Uncertain save');}return path==='/api/outlook/A'?{mail:mail('A')}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();f.nodes['outlook-link-mode'].value='new';f.nodes['outlook-customer-name'].value='SYNTHETIC';const event={preventDefault(){}};await f.nodes['outlook-link-form'].listeners.submit(event);await f.nodes['outlook-link-form'].listeners.submit(event);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].registration.original_text,mail('A').original.body);assert.equal(writes[0].registration.channel,'email');assert.equal(f.nodes['outlook-body'].textContent,mail('A').original.body);}finally{globalThis.document=old;}
});

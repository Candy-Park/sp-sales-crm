import test from 'node:test';
import assert from 'node:assert/strict';
import {initOutlook} from '../web/outlook.mjs';
class Node{
 constructor(tag='div'){this.tagName=tag;this.listeners={};this.children=[];this.value='';this.hidden=false;this.textContent='';this.disabled=false;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this.textContent='';}
}
const ids=['outlook-message','outlook-status','outlook-start','outlook-list','outlook-prev','outlook-next','outlook-inquiry','outlook-inquiry-prev','outlook-inquiry-next','outlook-review','outlook-subject','outlook-meta','outlook-body','outlook-link-form','outlook-linked-open','outlook-new-title','outlook-customer','outlook-customer-name','nav-outlook','outlook-reload','outlook-link-save','outlook-link-mode','detail-mails','outlook-filter','outlook-triage','outlook-triage-note'];
ids.push('mobile-outlook','outlook-review-sync','outlook-category-filter','outlook-classification-filter','outlook-proposal','outlook-label','outlook-role','outlook-category','outlook-classify','outlook-classification-section');
ids.push('outlook-workflow','outlook-workflow-preview');
function fixture(){const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));return {nodes,document:{getElementById:id=>nodes[id],createElement:tag=>new Node(tag)}};}
const mail=(id,body='SYNTHETIC <script>原文 😀')=>({id,state:'pending',excluded:false,triage_revision:1,subject:id,occurred_at:'2026-10-06T12:00:00Z',direction:'received',original:{body,sender:'synthetic@example.test',recipients:'synthetic@example.test',attachments:[]}});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const status={running:false,total:2,pending:2,held:0,receipted:0};
function setup(f,api){return initOutlook({api,message:(id,text)=>f.nodes[id].textContent=text,show(){},open:async()=>{}});}
function base(path){if(path==='/api/outlook/local')return status;if(path==='/api/lookups')return {customers:[]};if(path.startsWith('/api/inquiries'))return {inquiries:[],hasMore:false};return {mails:[mail('A'),mail('B')],hasMore:false};}

test('workflow preview only runs on explicit click and never writes classification, inquiry or Action',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const calls=[];setup(f,async(path,method)=>{calls.push({path,method});return path.endsWith('/workflow')?{workflow:{work_kind:'납기 확인',stage:'중간 답변 후보',waiting_on:'HQ 확인 필요',next_action:'추가 답변 확인',thread_count:2,later_sent:0,later_received:0,observed_at:'2026-10-06T12:00:00Z',evidence:['최신 본문'],caveats:['제안·미확정']}}:path==='/api/outlook/A'?{mail:mail('A')}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();assert.equal(calls.some(c=>c.path.endsWith('/workflow')),false);await f.nodes['outlook-workflow'].listeners.click();assert.match(f.nodes['outlook-workflow-preview'].textContent,/중간 답변 후보/);assert.match(f.nodes['outlook-workflow-preview'].textContent,/제안/);assert.equal(calls.some(c=>c.method),false);}finally{globalThis.document=old;}
});

test('late workflow after logout or mail change cannot restore private suggestion; failure is visible',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{let resolve;const out=setup(f,async path=>path.endsWith('/workflow')?new Promise(r=>resolve=r):path==='/api/outlook/A'?{mail:mail('A')}:base(path));f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();const p=f.nodes['outlook-workflow'].listeners.click();out.reset();resolve({workflow:{next_action:'PRIVATE_LATE'}});await p;assert.equal(f.nodes['outlook-workflow-preview'].textContent,'');assert.equal(f.nodes['outlook-workflow'].disabled,false);}finally{globalThis.document=old;}
});
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

test('filter change resets pagination and clears original while a stale original is discarded',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const paths=[];let resolve;setup(f,async path=>{paths.push(path);return path==='/api/outlook/A'?new Promise(r=>resolve=r):base(path);});f.nodes['nav-outlook'].listeners.click();await flush();f.nodes['outlook-next'].listeners.click();await flush();const review=f.nodes['outlook-list'].children[0].children[0].listeners.click();f.nodes['outlook-filter'].value='excluded';f.nodes['outlook-filter'].listeners.change();await flush();resolve({mail:mail('A','PRIVATE')});await review;assert.equal(paths.at(-1),'/api/outlook?offset=0&view=excluded');assert.equal(f.nodes['outlook-body'].textContent,'');assert.equal(f.nodes['outlook-review'].hidden,true);}finally{globalThis.document=old;}
});
test('exclusion and restoration send only the explicit decision and loaded revision',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const writes=[];let excluded=false;setup(f,async(path,method,body)=>{if(method){writes.push(body);excluded=body.excluded;return {result:{}};}return path==='/api/outlook/A'?{mail:{...mail('A'),excluded,triage_revision:excluded?2:1}}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();await f.nodes['outlook-triage'].listeners.click();assert.equal(f.nodes['outlook-body'].textContent,'');await f.nodes['outlook-list'].children[0].children[0].listeners.click();assert.equal(f.nodes['outlook-link-form'].hidden,true);await f.nodes['outlook-link-form'].listeners.submit({preventDefault(){}});await f.nodes['outlook-triage'].listeners.click();assert.deepEqual(writes,[{excluded:true,revision:1},{excluded:false,revision:2}]);}finally{globalThis.document=old;}
});
test('held exclusions keep their local-preservation notice; linked mails hide exclusion',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{let state='held';setup(f,async path=>path==='/api/outlook/A'?{mail:{...mail('A',null),state,body_length:2974731,excluded:state==='held'}}:base(path));f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();assert.match(f.nodes['outlook-body'].textContent,/2,974,731/);assert.equal(f.nodes['outlook-link-form'].hidden,true);assert.equal(f.nodes['outlook-triage'].textContent,'업무 목록으로 복원');state='linked';await f.nodes['outlook-list'].children[0].children[0].listeners.click();assert.equal(f.nodes['outlook-triage'].hidden,true);}finally{globalThis.document=old;}
});
test('uncertain triage retains original and revision for retry, and logout discards delayed results',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const writes=[];let resolve;const out=setup(f,async(path,method,body)=>{if(method){writes.push(body);if(writes.length===1)throw Error('Uncertain');return new Promise(r=>resolve=r);}return path==='/api/outlook/A'?{mail:mail('A')}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();await f.nodes['outlook-triage'].listeners.click();assert.equal(f.nodes['outlook-body'].textContent,mail('A').original.body);const pending=f.nodes['outlook-triage'].listeners.click();out.reset();resolve({result:{}});await pending;assert.deepEqual(writes[0],writes[1]);assert.equal(f.nodes['outlook-body'].textContent,'');assert.equal(f.nodes['outlook-message'].textContent,'');}finally{globalThis.document=old;}
});

test('switching the mail filter during linking never reopens the previous original',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{let resolve,opened=false;initOutlook({api:async(path,method)=>{if(method)return new Promise(r=>resolve=r);return path==='/api/outlook/A'?{mail:mail('A')}:base(path);},message:(id,text)=>f.nodes[id].textContent=text,show(){},open:async()=>{opened=true;}});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();f.nodes['outlook-link-mode'].value='existing';f.nodes['outlook-inquiry'].value='SYNTHETIC';const pending=f.nodes['outlook-link-form'].listeners.submit({preventDefault(){}});f.nodes['outlook-filter'].value='excluded';f.nodes['outlook-filter'].listeners.change();resolve({result:'SYNTHETIC'});await pending;assert.equal(f.nodes['outlook-body'].textContent,'');assert.equal(f.nodes['outlook-review'].hidden,true);assert.equal(opened,false);}finally{globalThis.document=old;}
});

test('filter change during post-link requery discards its original and navigation',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{let resolve,reads=0,opened=false;initOutlook({api:async(path,method)=>{if(method)return {result:'SYNTHETIC'};if(path==='/api/outlook/A'){if(++reads===1)return {mail:mail('A')};return new Promise(r=>resolve=r);}return base(path);},message:(id,text)=>f.nodes[id].textContent=text,show(){},open:async()=>{opened=true;}});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();f.nodes['outlook-link-mode'].value='existing';const pending=f.nodes['outlook-link-form'].listeners.submit({preventDefault(){}});await flush();f.nodes['outlook-filter'].value='excluded';f.nodes['outlook-filter'].listeners.change();resolve({mail:{...mail('A'),state:'linked'}});await pending;assert.equal(f.nodes['outlook-body'].textContent,'');assert.equal(opened,false);}finally{globalThis.document=old;}
});


test('classification retries keep identity, preserve inputs, and never exclude or link',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const writes=[];setup(f,async(path,method,body)=>{if(method){writes.push({path,body:structuredClone(body)});throw Error('Uncertain');}return path==='/api/outlook/A'?{mail:{...mail('A'),classification_revision:0,proposal:{role:'외부·관계 미확인',category:'스팸 의심·확인 필요',confidence:'낮음',evidence:['SYNTHETIC evidence']}}}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();f.nodes['outlook-role'].value='미확인';f.nodes['outlook-category'].value='스팸';await f.nodes['outlook-classify'].listeners.click();await f.nodes['outlook-classify'].listeners.click();assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].path,'/api/outlook/A/classification');assert.equal(writes[0].body.revision,0);assert.equal(f.nodes['outlook-category'].value,'스팸');assert.equal(f.nodes['outlook-body'].textContent,mail('A').original.body);}finally{globalThis.document=old;}
});

test('category filter and logout discard delayed classification, no private UI restoration',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{let resolve;const paths=[];const out=setup(f,async(path,method)=>{paths.push(path);if(method)return new Promise(r=>resolve=r);return path==='/api/outlook/A'?{mail:{...mail('A'),classification_revision:0}}:base(path);});f.nodes['nav-outlook'].listeners.click();await flush();await f.nodes['outlook-list'].children[0].children[0].listeners.click();f.nodes['outlook-role'].value='미확인';f.nodes['outlook-category'].value='스팸';const pending=f.nodes['outlook-classify'].listeners.click();f.nodes['outlook-category-filter'].value='HQ 업무';f.nodes['outlook-category-filter'].listeners.change();await flush();assert.ok(paths.some(p=>decodeURIComponent(p).includes('category=HQ 업무')));out.reset();resolve({result:{revision:1}});await pending;assert.equal(f.nodes['outlook-body'].textContent,'');assert.equal(f.nodes['outlook-label'].textContent,'');assert.equal(f.nodes['outlook-review'].hidden,true);}finally{globalThis.document=old;}
});


test('narrow-screen Outlook menu opens the same owner-scoped read-only list',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{const paths=[];setup(f,async(path,method)=>{assert.equal(method,undefined);paths.push(path);return base(path);});f.nodes['mobile-outlook'].listeners.click();await flush();assert.ok(paths.includes('/api/outlook/local'));assert.ok(paths.includes('/api/outlook?offset=0&view=active'));assert.equal(f.nodes['outlook-list'].children.length,2);}finally{globalThis.document=old;}
});

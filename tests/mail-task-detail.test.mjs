import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTaskDetail} from '../web/mail-task-detail.mjs';
class Node{constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.open=false;}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}addEventListener(name,fn){this.listeners[name]=fn;}}
const flatten=n=>[n,...n.children.flatMap(flatten)];
test('task detail separates next action, unknown delivery, evidence and collapsed original without invented draft',()=>{
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
 try{const root=new Node('section');let returned=false;renderTaskDetail(root,{subject:'SYNTHETIC <script>',handling:{category:'고객 업무'},work_review:{task_title:'고객 수령 확인',status:'출하 확인',next_action:'수령 여부 추적',task_owner:'HQ 담당',schedule:'수령일 미확인',limitation:'출하를 수령 완료로 보지 않습니다.',checks:[{label:'10개 출하',state:'확인'},{label:'고객 수령',state:'미확인'}],supporting_files:[{name:'SYNTHETIC.pdf'}]},original:{sender:'synthetic@example.test',recipients:'recipient@example.test',body:'SYNTHETIC 원문',attachments:[]}},()=>returned=true);
 const nodes=flatten(root);assert.ok(nodes.some(n=>n.textContent==='수령 여부 추적'));assert.ok(nodes.some(n=>n.textContent==='미확인'));assert.ok(nodes.some(n=>n.textContent==='SYNTHETIC.pdf'));assert.ok(nodes.some(n=>n.textContent==='SYNTHETIC <script>'));assert.ok(nodes.filter(n=>n.tagName==='details').every(n=>n.open===false));assert.ok(nodes.some(n=>n.textContent?.includes('초안은 아직 작성하지 않았습니다')));root.children[0].listeners.click();assert.equal(returned,true);
 }finally{globalThis.document=previous;}
});
test('held original does not show a missing or remotely copied body',()=>{
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
 try{const root=new Node('section');renderTaskDetail(root,{state:'held',original:{sender:'SYNTHETIC',recipients:'SYNTHETIC',body:'MUST NOT SHOW',attachments:[]}},()=>{});const text=flatten(root).map(n=>n.textContent||'').join(' ');assert.doesNotMatch(text,/MUST NOT SHOW/);assert.match(text,/로컬 원문/);
 }finally{globalThis.document=previous;}
});

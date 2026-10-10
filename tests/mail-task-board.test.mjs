import test from 'node:test';
import assert from 'node:assert/strict';
import {taskGroups,renderTaskBoard} from '../web/mail-task-board.mjs';
const mail=(id,bucket,due_date)=>({id,subject:'SYNTHETIC',handling:{include:true,category:'고객 업무'},work_review:{task_bucket:bucket,due_date,task_title:`행동 ${id}`,task_date_label:'기한 미확인',task_note:'출하와 수령 구분'}});
test('task board uses explicit evidence buckets, sorts dated actions, and excludes skipped mail',()=>{
 const rows=[mail('unknown',undefined),mail('late','action','2027-01-05'),mail('early','action','2026-10-12'),mail('waiting','waiting'),mail('answered','responded'),{...mail('skip','action'),handling:{include:false}}];
 const result=taskGroups(rows);assert.deepEqual(result.action.map(m=>m.id),['early','late']);assert.equal(result.waiting.length,1);assert.equal(result.responded.length,1);assert.equal(result.unknown.length,1);
});
class Node{constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.open=false;}append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}addEventListener(name,fn){this.listeners[name]=fn;}}
test('answered tasks start collapsed and evidence buttons open the exact mail without HTML insertion',()=>{
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
 try{const root=new Node('div'),opened=[];const row=mail('exact-id','action');row.work_review.task_title='<script>SYNTHETIC</script>';
 renderTaskBoard(root,[row,mail('done','responded')],id=>opened.push(id));
 const answered=root.children.find(n=>n.className==='task-section task-responded');assert.equal(answered.tagName,'details');assert.equal(answered.open,false);
 const action=root.children.find(n=>n.className==='task-section task-action');const card=action.children.at(-1).children[0];assert.equal(card.children[1].textContent,'<script>SYNTHETIC</script>');card.children.at(-1).listeners.click();assert.deepEqual(opened,['exact-id']);
 }finally{globalThis.document=previous;}
});

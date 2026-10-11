import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaGroups,initWorkAgenda} from '../web/work-agenda.mjs';
const t=(id,bucket,actions=[])=>({inquiry_id:id,current:{title:id,status:'new',review:{task_bucket:bucket,task_owner:'담당'},actions},timeline:[],confirmed_review:true});
test('one inquiry card combines saved actions and excludes completed work from todo',()=>{
 const result=agendaGroups([t('a','action',[{id:'1',status:'open',due_date:'2026-10-12'},{id:'2',status:'completed'}]),t('w','waiting',[{id:'3',status:'open'}]),t('d','responded')],{actions:[{id:'1',inquiry_id:'a',status:'open'}],inquiries:[{id:'a',status:'new'},{id:'manual',status:'new',title:'手動'}]});
 assert.equal(result.action.length,1);assert.equal(result.action[0].actions.length,1);assert.equal(result.waiting.length,1);assert.equal(result.decision.length,1);assert.equal(result.done.length,1);
});
test('unknown workflow and unreviewed newer mail require judgment without replacing confirmed Action',()=>{
 const row=t('a','action',[{id:'1',status:'open',description:'confirmed'}]);row.confirmed_review=false;row.timeline=[{direction:'sent',occurred_at:'2026-10-11T00:00:00Z'}];
 const groups=agendaGroups([row],{actions:[],inquiries:[]});assert.equal(groups.decision.length,1);assert.equal(groups.decision[0].actions[0].description,'confirmed');
});
class Node{constructor(){this.children=[];this.textContent='';this.events={};}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}addEventListener(k,v){this.events[k]=v;}}
const flush=()=>new Promise(r=>setImmediate(r));
test('new inbound request replaces waiting projection while preserving saved Action and due date',()=>{
 const row=t('a','waiting',[{id:'1',status:'open',description:'saved',due_date:'2026-10-12'}]);row.confirmed_review=false;
 row.observation={bucket:'action',next_action:'새 고객 요청에 답변',evidence_count:1};
 const groups=agendaGroups([row],{actions:[],inquiries:[]});
 assert.equal(groups.action.length,1);assert.equal(groups.action[0].actions[0].due_date,'2026-10-12');
});
test('outbound observation asks for answer coverage and never auto completes an inquiry',()=>{
 const row=t('a','action',[{id:'1',status:'open',description:'saved'}]);row.confirmed_review=false;row.observation={bucket:'decision',next_action:'회신 범위 확인'};
 assert.equal(agendaGroups([row],{actions:[],inquiries:[]}).decision.length,1);
 row.current.status='closed';assert.equal(agendaGroups([row],{actions:[],inquiries:[]}).decision.length,1);
 delete row.observation;assert.equal(agendaGroups([row],{actions:[],inquiries:[]}).done.length,1);
});
test('late agenda result after logout cannot restore protected mail or counts',async()=>{
 globalThis.document={createElement:()=>new Node()};const root=new Node(),resolves=[];let counts=0;
 const agenda=initWorkAgenda({root,isConnected:()=>true,api:()=>new Promise(r=>resolves.push(r)),open(){},onCounts(){counts++;}});
 agenda.start();agenda.stop();resolves[0]({threads:[t('private','action')]});resolves[1]({actions:[],inquiries:[]});await flush();assert.equal(root.children[3].children.length,0);assert.equal(counts,0);
});

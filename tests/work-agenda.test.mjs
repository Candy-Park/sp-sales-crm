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
test('latest mail action appears before the older saved Action while its date remains intact',async()=>{
 globalThis.document={createElement:()=>new Node()};const root=new Node();
 const row=t('a','waiting',[{id:'1',status:'open',description:'OLD saved plan',due_date:'2026-10-15'}]);row.confirmed_review=false;row.observation={bucket:'waiting',next_action:'2026-10-13 16개 출하 예정 — 실제 출하와 송장 확인'};
 const agenda=initWorkAgenda({root,isConnected:()=>true,api:async path=>path.includes('analysis')?{threads:[row]}:{actions:[],inquiries:[]},open(){}});
 agenda.start();await flush();
 const section=root.children[3].children.find(s=>s.children.some(n=>n.textContent==='상대 답변·처리 대기 · 1'));
 const card=section.children.find(n=>n.className==='task-card');
 assert.match(card.children[2].textContent,/새 메일 기준.*2026-10-13/);assert.match(card.children[3].textContent,/OLD saved plan.*2026-10-15/);
 agenda.stop();
});
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
test('home reading order is my todo, new requests, judgment, waiting, then closed history',async()=>{
 globalThis.document={createElement:()=>new Node()};const root=new Node();
 const candidates=[{source_key:'k',subject:'새 요청',category:'고객 업무',customer:'고객',next_action:'답변',evidence:[],excerpt:'',automatic_registration:true}];
 const agenda=initWorkAgenda({root,isConnected:()=>true,api:async path=>path.includes('analysis')?{threads:[t('a','action',[{id:'1',status:'open'}])],candidates}:{actions:[],inquiries:[]},open(){}});
 agenda.start();await flush();
 const titles=root.children[3].children.map(s=>s.children[0].textContent);
 assert.deepEqual(titles,['내가 할 일 · 1','새 담당 요청 · 1','판단 필요 · 0','상대 답변·처리 대기 · 0','회신 완료·종료 이력 · 0']);
});
test('agenda shares loaded groups with the home brief and reports failures instead of zero',async()=>{
 globalThis.document={createElement:()=>new Node()};const root=new Node(),seen=[],errors=[];let fail=false;
 const agenda=initWorkAgenda({root,isConnected:()=>true,api:async path=>{if(fail)throw Error('조회 실패');return path.includes('analysis')?{threads:[t('a','action',[{id:'1',status:'open'}])]}:{actions:[],inquiries:[],truncated:true};},open(){},onData:d=>seen.push(d),onError:m=>errors.push(m)});
 agenda.start();await flush();
 assert.equal(seen.length,1);assert.equal(seen[0].groups.action.length,1);assert.equal(seen[0].dashboard.truncated,true);assert.ok(Array.isArray(seen[0].analysis.threads));
 fail=true;agenda.start();await flush();assert.deepEqual(errors,['조회 실패']);
});

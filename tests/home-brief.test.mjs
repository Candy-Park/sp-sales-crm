import test from 'node:test';
import assert from 'node:assert/strict';
import {priorityItems,uncertainItems,initHomeBrief} from '../web/home-brief.mjs';

const today='2026-10-22';
const row=(id,actions,extra={})=>({id,title:'업무 '+id,actions,review:{task_owner:'Candy'},...extra});
const act=(id,due,kind='customer_reply',extra={})=>({id,status:'open',description:'할 일 '+id,due_date:due,kind,...extra});
const empty={action:[],waiting:[],decision:[],done:[]};

test('priority puts overdue first, then today, then new mail judgment, then due within 3 days',()=>{
 const groups={...empty,
  action:[row('soon',[act('s','2026-10-24')]),row('late',[act('l','2026-10-20','hq_inquiry')]),row('far',[act('f','2026-11-30')]),row('nodue',[act('n',null)])],
  decision:[row('mail',[],{thread:{observation:{next_action:'새 견적 요청 확인'}}})],
  waiting:[row('wait',[act('w',today,'customer_followup',{waiting_target:'고객'})]),row('wait2',[act('w2','2026-10-23')])]};
 const {items,more}=priorityItems(groups,{today});
 assert.deepEqual(items.map(i=>i.key),['a:l','a:w','d:mail','a:s']);
 assert.equal(more,0);
 assert.equal(items[0].reason,'기한 2일 지남 · HQ 문의');
 assert.equal(items[1].reason,'오늘 기한 · 대기 중 후속 확인 · 고객 후속 확인');
 assert.equal(items[2].source,'suggest');assert.equal(items[2].reason,'새 메일 도착 · 판단 필요');
 assert.equal(items[3].reason,'2일 뒤 기한 · 고객 회신');
 assert.equal(items[0].source,'fact');assert.equal(items[0].id,'late');
});

test('completed work and closed history never become priorities, and the list is capped with a remainder count',()=>{
 const many=Array.from({length:7},(_,n)=>row('r'+n,[act('x'+n,'2026-10-0'+(n+1))]));
 const {items,more}=priorityItems({...empty,action:many,done:[row('closed',[act('c','2026-10-01')])]},{today,limit:5});
 assert.equal(items.length,5);assert.equal(more,2);assert.ok(!items.some(i=>i.id==='closed'));
});

test('new requests waiting for registration are suggestions with a plain reason',()=>{
 const pending=[{source_key:'k1',subject:'새 사양 요청',next_action:'사양 답변',automatic_registration:false}];
 const {items}=priorityItems(empty,{today,pending});
 assert.equal(items[0].source,'suggest');assert.equal(items[0].reason,'새 담당 요청 · 연결할 고객 선택 필요');assert.equal(items[0].id,null);
});

test('uncertain items name what was not checked instead of hiding it',()=>{
 const groups={...empty,
  action:[row('a',[act('1',null),act('2','2026-10-25')]),row('b',[act('3',today)],{review:{}})],
  decision:[row('c',[],{review:{},thread:{timeline:[{held:true},{held:false}]}})]};
 const list=uncertainItems({groups,dashboard:{truncated:true},follow:{remote:true,agent_online:false,last_synced_at:null}});
 assert.deepEqual(list,[
  '저장 업무는 최근 100건만 확인했습니다. 나머지는 문의 조회에서 확인하세요.',
  '기한이 없는 할 일 1건 — 기한 확인 필요',
  '담당자가 확인되지 않은 업무 2건',
  '할 일이 저장되지 않은 업무 1건 — 다음 행동 확인 필요',
  '표시를 보류한 메일 1통 — 원문 확인 필요',
  '수집 PC 미연결 — 아직 동기화 기록이 없어 새 메일은 확인하지 못했습니다.']);
 assert.deepEqual(uncertainItems({groups:empty,dashboard:{},follow:{error:'Outlook 오류'}}),['메일 확인 오류 — Outlook 오류']);
 assert.deepEqual(uncertainItems({groups:empty,dashboard:{},follow:{skipped:'outlook_not_running'}}),['Outlook이 꺼져 있어 이번 메일 확인을 건너뛰었습니다.']);
 assert.deepEqual(uncertainItems({groups:empty,dashboard:{}}),[]);
});

class Node{constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.events={};this.className='';}append(...n){this.children.push(...n);}prepend(...n){this.children.unshift(...n);}replaceChildren(...n){this.children=n;}addEventListener(k,v){this.events[k]=v;}}
const texts=n=>[n.textContent,...n.children.flatMap(texts)].filter(Boolean);

test('brief shows a failure as unknown instead of zero and opens saved work from a priority row',()=>{
 globalThis.document={createElement:tag=>new Node(tag)};
 const priorityRoot=new Node('section'),checkRoot=new Node('section'),opened=[];
 const brief=initHomeBrief({priorityRoot,checkRoot,open:id=>opened.push(id),today:()=>today});
 brief.update({groups:{...empty,action:[row('late',[act('l','2026-10-20')]),row('owner',[act('o',null)],{review:{}})]},dashboard:{},analysis:{candidates:[]}});
 assert.match(texts(checkRoot).join('|'),/담당자가 확인되지 않은 업무 1건/);
 const all=texts(priorityRoot).join('|');
 assert.match(all,/할 일 l\|확인\|/);assert.match(all,/이유: 기한 2일 지남 · 고객 회신/);
 const button=JSON.stringify(priorityRoot).includes('업무 열기');assert.ok(button);
 const find=(n)=>n.tag==='button'&&n.textContent==='업무 열기'?n:n.children.map(find).find(Boolean);
 find(priorityRoot).events.click();assert.deepEqual(opened,['late']);
 brief.fail('네트워크 오류');
 assert.match(texts(priorityRoot).join('|'),/업무를 불러오지 못했습니다/);
 assert.match(texts(checkRoot).join('|'),/업무 조회 실패 — 네트워크 오류/);
 assert.doesNotMatch(texts(checkRoot).join('|'),/담당자가 확인되지 않은/);
 brief.reset();assert.doesNotMatch(texts(priorityRoot).join('|'),/할 일 l/);
});
test('waiting card lists who and when to follow up, and hero counts match the priority list',async()=>{
 const {waitingItems,homeCounts}=await import('../web/home-brief.mjs');
 const groups={...empty,action:[row('a',[act('1','2026-10-20'),act('2',today)])],waiting:[row('w2',[act('x',null)]),row('w1',[act('y','2026-10-25',undefined,{waiting_target:'HQ'})])]};
 assert.deepEqual(waitingItems(groups).map(i=>[i.id,i.who,i.due]),[['w1','HQ','2026-10-25'],['w2','','']]);
 assert.deepEqual(homeCounts(groups,{today}),{first:2,overdue:1,dueToday:1,waiting:2});
});

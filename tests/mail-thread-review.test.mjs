import test from 'node:test';
import assert from 'node:assert/strict';
import {initThreadReview} from '../web/mail-thread-review.mjs';
class Element{
 constructor(){this.children=[];this.events={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 addEventListener(name,fn){this.events[name]=fn;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const thread=status=>({inquiry_id:'SYNTHETIC',received:2,sent:1,current:{title:'SYNTHETIC',status,next_action:'confirmed',actions:[]},proposal:{next_action:'proposed'},timeline:[{occurred_at:'2026-10-11T00:00:00Z',direction:'sent',excerpt:'<script>synthetic</script>'}],omitted:1});
test('analysis displays confirmed state separately, drafts only on click and does not create action',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element(),calls=[],drafts=[];
 const panel=initThreadReview({root,isConnected:()=>true,api:async path=>{calls.push(path);return {threads:[thread('new'),thread('closed')]};},open(){},prepare:async(...args)=>{drafts.push(args);return true;}});
 panel.start();await flush();const cards=root.children[4].children;
 assert.match(cards[0].children[1].textContent,/confirmed/);assert.equal(drafts.length,0);assert.deepEqual(calls,['/api/followups?view=analysis']);
 await cards[0].children.find(n=>n.textContent==='제안으로 할 일 작성').events.click();assert.deepEqual(drafts,[['SYNTHETIC','proposed']]);assert.equal(calls.length,1);
 assert.equal(cards[1].children.filter(n=>n.textContent==='제안으로 할 일 작성').length,0);panel.stop();assert.equal(root.children[4].children.length,0);
});
test('logout discards pending original excerpts',async()=>{
 globalThis.document={createElement:()=>new Element()};const root=new Element();let resolve;
 const panel=initThreadReview({root,isConnected:()=>true,api:()=>new Promise(r=>resolve=r),open(){},prepare(){}});
 panel.start();panel.stop();resolve({threads:[thread('new')]});await flush();assert.equal(root.children[4].children.length,0);assert.equal(root.children[3].disabled,true);
});

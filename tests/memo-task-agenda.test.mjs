import test from 'node:test';
import assert from 'node:assert/strict';
import {initMemoTaskAgenda} from '../web/memo-task-agenda.mjs';
class Element{constructor(tag='div'){this.tagName=tag;this.children=[];this.events={};this.dataset={};this.textContent='';}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(){}addEventListener(k,f){this.events[k]=f;}querySelectorAll(s){return this.children.flatMap(c=>[c,...c.querySelectorAll(s)]).filter(c=>c.tagName===s);}}
const text=n=>n.textContent+n.children.map(text).join('');
test('independent agenda shows one unique open task, keeps null date separate and reflects explicit dates/completion',async()=>{
 globalThis.document={createElement:t=>new Element(t)};const root=new Element(),opened=[],toggled=[];const agenda=initMemoTaskAgenda({root,onOpen:id=>opened.push(id),onToggle:async id=>toggled.push(id)});const phone={id:'phone',content:'SYNTHETIC PHONE',homeTask:true,dueDate:null,completedAt:null};
 agenda.setItems([phone,phone,{id:'personal',content:'PRIVATE',homeTask:false},{id:'done',content:'DONE',homeTask:true,completedAt:'now'}]);assert.equal(root.querySelectorAll('input').length,1);assert.match(text(root),/기한 없음/);assert.doesNotMatch(text(root),/PRIVATE|DONE/);await root.querySelectorAll('button')[0].events.click();assert.deepEqual(opened,['phone']);await root.querySelectorAll('input')[0].events.change();assert.deepEqual(toggled,['phone']);
 for(const [date,label] of [['2000-01-01','기한 지남'],['2099-01-01','예정']]){agenda.setItems([{...phone,dueDate:date}]);assert.match(text(root),new RegExp(date+' · '+label));}
 agenda.setItems([{...phone,completedAt:'now'}]);assert.equal(root.querySelectorAll('input').length,0);agenda.reset();assert.doesNotMatch(text(root),/SYNTHETIC/);
});
test('agenda surfaces uncertain completion and blocks double clicks during save',async()=>{
 globalThis.document={createElement:t=>new Element(t)};const root=new Element();let reject,calls=0;const agenda=initMemoTaskAgenda({root,onOpen(){},onToggle:()=>{calls++;return new Promise((_,r)=>reject=r);}});agenda.setItems([{id:'p',content:'SYNTHETIC',homeTask:true}]);const check=root.querySelectorAll('input')[0];const first=check.events.change();await check.events.change();assert.equal(calls,1);reject(Error('결과 미확인'));await first;assert.match(text(root),/결과 미확인/);agenda.reset();
});

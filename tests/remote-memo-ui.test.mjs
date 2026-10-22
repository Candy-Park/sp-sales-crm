import test from 'node:test';
import assert from 'node:assert/strict';
import {initMemos} from '../web/local-memos.mjs';
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.events={};this.dataset={};this.value='';this.textContent='';this.classList={add(){},remove(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(){} addEventListener(name,fn){this.events[name]=fn;}
 querySelectorAll(selector){const all=this.children.flatMap(c=>[c,...c.querySelectorAll(selector)]);return all.filter(c=>selector==='[data-kind]'?c.dataset.kind:selector.split(',').includes(c.tagName));}
 focus(){}
}
const flush=()=>new Promise(r=>setImmediate(r));
const text=node=>node.textContent+node.children.map(text).join('');
test('cloud memo logout clears draft and blocks late private load or save results',async()=>{
 globalThis.document={createElement:tag=>new Element(tag)};
 const quick=new Element(),page=new Element();let resolve;
 const memos=initMemos({quickRoot:quick,pageRoot:page,cloud:true,autoload:false,api:()=>new Promise(r=>resolve=r)});
 const loading=memos.load();memos.reset();resolve({memos:[{content:'PRIVATE OLD',id:'x',createdAt:'2026-10-13',completedAt:null,category:'work'}]});await loading;
 assert.doesNotMatch(text(page),/PRIVATE OLD/);
 const textarea=quick.querySelectorAll('textarea')[0];textarea.value='PRIVATE DRAFT';
 const saving=quick.querySelectorAll('form')[0].events.submit({preventDefault(){}});await flush();
 memos.reset();resolve({memo:{content:'PRIVATE SAVED',id:'x',createdAt:'2026-10-13',completedAt:null,category:'work'}});await saving;
 assert.equal(memos.hasDraft(),false);assert.doesNotMatch(text(page),/PRIVATE SAVED/);assert.equal(textarea.value,'');
});

test('shared memo publishes current state, preserves provenance and refetches uncertain toggles before reuse',async()=>{
 globalThis.document={createElement:t=>new Element(t)};const page=new Element(),quick=new Element();let state=[],gets=0,patches=0;
 const item={id:'m',content:'SYNTHETIC phone',category:'work',createdAt:'2026-10-21',completedAt:null,revision:1,homeTask:true,origin:{id:'source',capturedAt:'2026-10-21',snapshot:'{"content":"ORIGINAL"}'}};
 const memos=initMemos({quickRoot:quick,pageRoot:page,cloud:true,autoload:false,onChanged:items=>state=items,api:async(p,method)=>{if(method){patches++;throw Error('uncertain');}gets++;return {memos:[{...item,completedAt:patches?'now':null,revision:patches?2:1}]};}});
 await memos.load();assert.equal(state.length,1);assert.match(text(page),/원본 정보/);memos.open('m');assert.equal(page.querySelectorAll('textarea')[0].value,item.content);
 await memos.toggle('m');assert.equal(gets,2);assert.equal(patches,1);assert.equal(state[0].revision,2);assert.match(text(page),/결과/);memos.reset();assert.equal(state.length,0);assert.doesNotMatch(text(page),/ORIGINAL/);
});
test('uncertain completion with failed refetch locks next toggle until successful manual refresh',async()=>{
 globalThis.document={createElement:t=>new Element(t)};let fail=false,patches=0;const memo={id:'p',content:'SYNTHETIC',category:'work',createdAt:'2026-10-21',revision:1};const memos=initMemos({quickRoot:new Element(),pageRoot:new Element(),autoload:false,api:async(path,method)=>{if(method){patches++;fail=true;throw Error('lost response');}if(fail)throw Error('offline');return {memos:[memo]};}});
 await memos.load();await assert.rejects(memos.toggle('p'),/결과 미확인/);await assert.rejects(memos.toggle('p'),/결과 미확인/);assert.equal(patches,1);fail=false;assert.equal(await memos.load(),true);
});
test('failed completion followed by unchanged server state reports failure to home without inverse retry',async()=>{
 globalThis.document={createElement:t=>new Element(t)};let patches=0;const memo={id:'p',content:'SYNTHETIC',category:'work',createdAt:'2026-10-21',completedAt:null,revision:1};const page=new Element();const memos=initMemos({quickRoot:new Element(),pageRoot:page,autoload:false,api:async(path,method)=>{if(method){patches++;throw Error('conflict');}return {memos:[memo]};}});await memos.load();await assert.rejects(memos.toggle('p'),/반영되지|결과/);assert.equal(patches,1);assert.match(text(page),/반영되지/);
});

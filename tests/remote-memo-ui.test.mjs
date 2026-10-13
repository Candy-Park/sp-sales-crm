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

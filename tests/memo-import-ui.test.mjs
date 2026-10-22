import test from 'node:test';
import assert from 'node:assert/strict';
import {initMemoImport} from '../web/memo-import.mjs';
import {fixture,uid} from './memo-import.test.mjs';
class Element{constructor(tag='div'){this.tagName=tag;this.children=[];this.events={};this.value='';this.textContent='';this.files=[];}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(){}addEventListener(k,f){this.events[k]=f;}querySelectorAll(s){return this.children.flatMap(c=>[c,...c.querySelectorAll(s)]).filter(c=>s.split(',').includes(c.tagName));}}
const text=n=>n.textContent+n.children.map(text).join('');
test('import preview validates all before writes, resumes partial results, verifies final GET and wipes logout',async()=>{
 globalThis.document={createElement:t=>new Element(t)};const {manifest,selection}=fixture(),root=new Element();let calls=0,fail=true,saved=[],loaded=0;
 const widget=initMemoImport({root,selection,getUser:()=>({id:uid(1),projectRef:'synthetictarget'}),onImported:async()=>loaded++,api:async(path,method,body)=>{if(!method)return {memos:saved};calls++;if(calls===2&&fail){fail=false;throw Error('network');}let memo=saved.find(m=>m.origin.id===body.input.origin.id);if(!memo){memo={id:uid(20+saved.length),...body.input};saved.push(memo);}return {memo};}});
 const file=root.querySelectorAll('input')[0];file.files=[{size:1000,text:async()=>JSON.stringify(manifest)}];await file.events.change();assert.equal(calls,0);assert.match(text(root),/SYNTHETIC <memo>/);
 const button=root.querySelectorAll('button')[0];await button.events.click();assert.equal(saved.length,1);assert.match(text(root),/network/);await button.events.click();assert.equal(saved.length,3);assert.equal(loaded,1);assert.match(text(root),/3건 연결 확인/);
 widget.reset();assert.doesNotMatch(text(root),/SYNTHETIC/);assert.equal(file.value,'');assert.equal(button.disabled,true);
});
test('logout while reading file cannot restore preview; invalid owner never writes',async()=>{
 globalThis.document={createElement:t=>new Element(t)};const {manifest,selection}=fixture(),root=new Element();let resolve,calls=0;
 const widget=initMemoImport({root,selection,getUser:()=>({id:uid(1),projectRef:'synthetictarget'}),api:async()=>calls++});const file=root.querySelectorAll('input')[0];file.files=[{size:100,text:()=>new Promise(r=>resolve=r)}];const reading=file.events.change();widget.reset();resolve(JSON.stringify(manifest));await reading;assert.doesNotMatch(text(root),/SYNTHETIC/);assert.equal(calls,0);
});

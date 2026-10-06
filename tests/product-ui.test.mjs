import test from 'node:test';
import assert from 'node:assert/strict';
import {initProducts} from '../web/products.mjs';
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.listeners={};this.elements=[];}
 append(n){this.children.push(n);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(){}
 addEventListener(name,fn){this.listeners[name]=fn;}
 reset(){for(const input of this.elements)input.value='';}
}
const ids=['product-search-form','product-results','product-history','product-message','product-history-message','product-history-reload'];
function fixture(){const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));return {nodes,document:{getElementById:id=>nodes[id],createElement:tag=>new Node(tag)}};}
test('latest product search response wins even if an older request finishes last',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{
  const pending=[];const finder=initProducts({api:async path=>path.includes('/api/products')?new Promise(resolve=>pending.push(resolve)):{links:[]},message:(id,s)=>f.nodes[id].textContent=s});
  finder.bind({id:'synthetic',status:'new'});
  const submit=()=>f.nodes['product-search-form'].listeners.submit({preventDefault(){},currentTarget:f.nodes['product-search-form']});
  const first=submit(),second=submit();
  pending[1]({products:[],catalogCount:2});await second;
  pending[0]({products:[],catalogCount:99});await first;
  assert.match(f.nodes['product-message'].textContent,/등록 2개/);
 }finally{globalThis.document=old;}
});
test('logout/reset prevents pending catalogue or history responses restoring private UI',async()=>{
 const f=fixture(),old=globalThis.document;globalThis.document=f.document;
 try{
  let finish;const finder=initProducts({api:async()=>new Promise(resolve=>finish=resolve),message:(id,s)=>f.nodes[id].textContent=s});
  finder.bind({id:'synthetic',status:'new'});finder.reset();finish({links:[{snapshot:{spec:{pn:'PRIVATE'}},created_at:'2026-10-07T00:00:00Z',reason:'PRIVATE'}]});await Promise.resolve();await Promise.resolve();
  assert.equal(f.nodes['product-history'].children.length,0);assert.equal(f.nodes['product-history-message'].textContent,'');
 }finally{globalThis.document=old;}
});

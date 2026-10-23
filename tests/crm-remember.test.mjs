import test from 'node:test';
import assert from 'node:assert/strict';
import {initCRMConnection} from '../web/crm-connection.mjs';

class Element{
 constructor(tag){this.tag=tag;this.classList={toggle(){}};this.value='';this.checked=false;this.hidden=false;this.events={};this.children=[];}
 setAttribute(){} append(...n){this.children.push(...n);} before(...n){this.inserted=n;} addEventListener(k,f){this.events[k]=f;}
 showModal(){this.open=true;} close(){this.open=false;}
}
const flag='sp-sales-crm-remember',tokenKey='sp-sales-crm-auth';
function setup({storage,meStatus=200}={}){
 const nodes=new Map(),created=[];
 globalThis.document={createElement:tag=>{const n=new Element(tag);created.push(n);return n;},body:new Element('body'),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);}};
 const calls={connected:[],signOut:0};
 const clientFactory=(url,key,options)=>{
  const store=options.auth.storage;calls.options=options;
  return {auth:{
   getSession:async()=>{const raw=store?.getItem(tokenKey);return {data:{session:raw?{access_token:raw}:null}};},
   signInWithPassword:async()=>{store?.setItem(tokenKey,'SYNTHETIC_TOKEN');return {error:null};},
   signOut:async()=>{calls.signOut++;store?.removeItem(tokenKey);},
   onAuthStateChange(){}
  }};
 };
 const fetcher=async path=>path==='/api/crm/config'?Response.json({url:'https://glscckjmlwvxilzneqdf.supabase.co',publishableKey:'sb_publishable_SYNTHETIC'}):path==='/api/crm/me'?Response.json(meStatus===200?{user:{email:'synthetic@example.com'}}:{error:'denied'},{status:meStatus}):Response.json({});
 const connection=initCRMConnection({remember:true,storage,onConnected:u=>calls.connected.push(u),onDisconnected(){},clientFactory,fetcher});
 const checkbox=created.find(n=>n.tag==='input'&&n.type==='checkbox');
 const login=async()=>{const g=globalThis.document.getElementById;g('email').value='synthetic@example.com';g('password').value='pw';await g('login-form').events.submit({preventDefault(){}});};
 return {connection,checkbox,login,nodes,calls};
}
const memoryStorage=()=>{const m=new Map();return {m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

test('unchecked login keeps the session in memory only, as before',async()=>{
 const storage=memoryStorage(),s=setup({storage});await s.connection.ready;
 assert.ok(s.checkbox,'remember checkbox exists');assert.equal(s.checkbox.checked,false);
 await s.login();
 assert.equal(s.connection.isConnected(),true);assert.equal(storage.m.has(tokenKey),false);assert.equal(storage.m.has(flag),false);
});

test('checked login is stored on this browser and restored on the next page load after an account check',async()=>{
 const storage=memoryStorage(),first=setup({storage});await first.connection.ready;
 first.checkbox.checked=true;await first.login();
 assert.equal(storage.m.get(flag),'1');assert.equal(storage.m.get(tokenKey),'SYNTHETIC_TOKEN');
 const next=setup({storage});await next.connection.ready;
 assert.equal(next.connection.isConnected(),true);assert.equal(next.calls.connected.length,1);assert.equal(next.calls.connected[0].email,'synthetic@example.com');
});

test('a remembered session for a denied account is discarded instead of restored',async()=>{
 const storage=memoryStorage();storage.setItem(flag,'1');storage.setItem(tokenKey,'OLD');
 const s=setup({storage,meStatus:403});await s.connection.ready;
 assert.equal(s.connection.isConnected(),false);assert.equal(s.calls.connected.length,0);
 assert.equal(storage.m.has(flag),false);assert.equal(storage.m.has(tokenKey),false);
});

test('logout forgets the remembered login on this browser',async()=>{
 const storage=memoryStorage(),s=setup({storage});await s.connection.ready;
 s.checkbox.checked=true;await s.login();
 await globalThis.document.getElementById('logout-button').events.click();
 assert.equal(s.connection.isConnected(),false);assert.equal(storage.m.has(flag),false);assert.equal(storage.m.has(tokenKey),false);
});

test('blocked browser storage falls back to memory without breaking login',async()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const s=setup({storage});await s.connection.ready;s.checkbox.checked=true;await s.login();
 assert.equal(s.connection.isConnected(),true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {initCRMConnection} from '../web/crm-connection.mjs';
class Element{
 constructor(){this.classList={toggle(){}};this.value='';}
 setAttribute(){} append(){} before(){} addEventListener(){} showModal(){this.open=true;} close(){this.open=false;}
}
test('partial mail-save explanation reaches the user instead of a generic CRM error',async()=>{
 const nodes=new Map();globalThis.document={createElement:()=>new Element(),body:new Element(),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
 const connection=initCRMConnection({onConnected(){},onDisconnected(){},clientFactory:()=>({auth:{getSession:async()=>({data:{session:{access_token:'SYNTHETIC_ONLY'}}}),onAuthStateChange(){}}}),fetcher:async path=>path==='/api/crm/config'?Response.json({url:'https://glscckjmlwvxilzneqdf.supabase.co',publishableKey:'sb_publishable_SYNTHETIC_ONLY'}):Response.json({incomplete:true,message:'SYNTHETIC partial save: recheck same request'},{status:409})});
 await connection.ready;
 await assert.rejects(()=>connection.api('/api/followups','POST',{operation:'reconcile'}),/SYNTHETIC partial save/);
});

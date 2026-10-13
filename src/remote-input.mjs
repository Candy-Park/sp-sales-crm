const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const fail=()=>{throw Error('외부 저장 입력을 확인하세요.');};
const keys=(value,expected)=>object(value)&&Object.keys(value).sort().join(',')===expected.sort().join(',');
export function memoInput(body){
 const create=keys(body,['requestId','input']);
 if(!create&&!keys(body,['requestId','revision','patch'])||!uuid.test(body?.requestId||''))fail();
 const patch=create?body.input:body.patch;
 if(!object(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!['content','category','dueDate','completed'].includes(k)))fail();
 if(create&&!keys(patch,['content','category','dueDate']))fail();
 if(!create&&(!Number.isSafeInteger(body.revision)||body.revision<1))fail();
 const result={...patch};
 if('content'in patch){if(typeof patch.content!=='string'||!patch.content.trim()||patch.content.length>10000||patch.content.includes('\0'))fail();result.content=patch.content.trim();}
 if('category'in patch&&!['personal','work'].includes(patch.category))fail();
 if('dueDate'in patch&&patch.dueDate!==null){const d=patch.dueDate;if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)fail();}
 if('completed'in patch&&typeof patch.completed!=='boolean')fail();
 return {requestId:body.requestId,revision:create?0:body.revision,patch:result};
}
export function snapshotInput(body){
 if(!keys(body,['requestId','kind','revision','payload'])||!uuid.test(body.requestId||'')||!['handling','analysis','status','sources'].includes(body.kind)||!Number.isSafeInteger(body.revision)||body.revision<0||!object(body.payload))fail();
 const encoded=JSON.stringify(body.payload);
 if(new TextEncoder().encode(encoded).length>524288||/-----BEGIN .*PRIVATE KEY-----|\b(?:sb_secret_|gh[pousr]_)[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/.test(encoded))fail();
 return body;
}

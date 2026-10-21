const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const invalid=()=>{throw Error('선택 목록·원본 스냅샷·대상 계정을 확인하세요.');};
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
export function validateMemoOrigin(origin,input){
 if(!exact(origin,['projectRef','ownerId','entity','id','revision','createdAt','updatedAt','capturedAt','snapshot','sha256'])||!/^\w{1,64}$/.test(origin.projectRef)||!uuid.test(origin.ownerId)||!uuid.test(origin.id)||origin.entity!=='crm_memo'||!Number.isSafeInteger(origin.revision)||origin.revision<1||![origin.createdAt,origin.updatedAt,origin.capturedAt].every(timestamp)||typeof origin.snapshot!=='string'||origin.snapshot.length>20000||!(/^[a-f0-9]{64}$/).test(origin.sha256))invalid();
 let s;try{s=JSON.parse(origin.snapshot);}catch{invalid();}
 if(!exact(s,['id','owner_id','content','category','due_date','completed_at','revision','created_at','updated_at'])||s.id!==origin.id||s.owner_id!==origin.ownerId||s.revision!==origin.revision||s.created_at!==origin.createdAt||s.updated_at!==origin.updatedAt||typeof s.content!=='string'||!s.content.trim()||s.content.length>10000||s.content.includes('\0')||!['personal','work'].includes(s.category)||s.due_date!==null||s.completed_at!==null||s.content.trim()!==input.content||s.category!==input.category||input.dueDate!==null||typeof input.homeTask!=='boolean'||(input.homeTask&&s.category!=='work'))invalid();
 if(JSON.stringify(Object.fromEntries(Object.keys(s).sort().map(k=>[k,s[k]])))!==origin.snapshot)invalid();
 return s;
}
export async function validateMemoImport(manifest,selection,targetOwnerId){
 if(!selection||selection.schema_version!==1||manifest?.schema_version!==1||!uuid.test(targetOwnerId||'')||targetOwnerId!==selection.expected_target_owner_id||manifest.targetOwnerId!==targetOwnerId||manifest.targetProjectRef!==selection.expected_target_project_ref||!Array.isArray(selection.records)||selection.records.length!==3||!Array.isArray(manifest.records)||manifest.records.length!==3||new Set(selection.records.map(r=>r.source_id)).size!==3||new Set(manifest.records.map(r=>r?.origin?.id)).size!==3)invalid();
 const records=structuredClone(manifest.records);
 for(const r of records){if(!exact(r,['content','category','dueDate','homeTask','origin']))invalid();validateMemoOrigin(r.origin,r);const expected=selection.records.find(e=>e.source_id===r.origin.id);
  if(!expected||r.origin.projectRef!==selection.source_project_ref||r.origin.ownerId!==selection.source_owner_id||r.origin.revision!==expected.expected_revision||r.category!==expected.category||r.homeTask!==expected.homeTask)invalid();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(r.origin.snapshot))),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==r.origin.sha256)invalid();
 }
 return records;
}

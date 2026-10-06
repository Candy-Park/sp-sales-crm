// Only the two user-approved local Datasheets. No network, upload, keys or original-file edits.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
const output='D:/AI/projects/sp-sales-crm/outputs/';
const input=JSON.parse(await readFile(output+'initial-products.json','utf8'));
const pns=['SPQ-CE-4LQ-CB','SPQ-CE-4SQ-CA'];
const batch='41000000-0000-4000-8000-000000000001';
const owner='a11803c8-01ef-4563-95bb-c0024541be2c';
const hash=data=>createHash('sha256').update(data).digest('hex');
if(input.products?.length!==2||new Set(input.products.map(p=>p.pn)).size!==2||input.products.some(p=>!pns.includes(p.pn)))throw Error('Unexpected product scope');
const rows=[];
for(const p of input.products){
 const expectedFile=p.pn==='SPQ-CE-4LQ-CB'?'DS-10584-00_SPQ-CE-4LQ-CB.pdf':'DS-9829-03_SPQ-CE-4SQ-CA.pdf';
 if(basename(p.source.file)!==expectedFile||p.source.file.includes('..'))throw Error('Unexpected source file');
 if(p.family_rate_gbps!==100||p.form_factor!=='QSFP28'||p.product_status!=='Unknown'||p.source.latest_revision_verified!==false||p.temperature?.basis!=='case_operating'||!p.reach.every(r=>r.min_m>=0&&r.max_m>=r.min_m)||[p.price,p.lead_time,p.last_hq_confirmed_at].some(v=>v!==null))throw Error('Product fields or unknown facts changed; review required');
 const sourceHash=hash(await readFile(p.source.file));
 const spec={...p,source:{...p.source,file:basename(p.source.file)}};
 rows.push({id:'42000000-0000-4000-8000-00000000000'+(pns.indexOf(p.pn)+1),owner_id:owner,batch_id:batch,pn:p.pn,spec,source_sha256:sourceHash,reviewed_on:input.reviewed_on});
}
const preview={batch_id:batch,reviewed_on:input.reviewed_on,scope:'two approved 100G products; specifications only, original PDFs not uploaded',products:rows};
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
let schema=await readFile('db/product-search.sql','utf8');
schema=schema.replace(/begin;\s*/,'').replace(/commit;\s*$/,'');
const grants=`grant select on public.sales_product to authenticated;
grant select,insert on public.sales_inquiry_product to authenticated;
grant execute on function public.sales_link_product(uuid,jsonb) to authenticated;`;
const seed=rows.map(r=>`insert into public.sales_product(id,owner_id,batch_id,pn,spec,source_sha256,reviewed_on) values(${quote(r.id)},${quote(owner)},${quote(batch)},${quote(r.pn)},${quote(JSON.stringify(r.spec))}::jsonb,${quote(r.source_sha256)},${quote(r.reviewed_on)});`).join('\n');
const final=`-- PENDING execution-time access confirmation; do not run before rollback suite passes.
-- Target: NEW sp-sales-crm / glscckjmlwvxilzneqdf. Existing enabled owner only.
-- Import 2 specs: SPQ-CE-4LQ-CB (LR4), SPQ-CE-4SQ-CA (SR4).
-- Grants: catalogue SELECT; candidate history SELECT/INSERT; invoker RPC EXECUTE.
-- Owner RLS/allowlist retained. No anon/new user/product edit/history UPDATE/DELETE.
-- Source filename/hash/evidence only. Original PDFs/private paths not uploaded.
-- Unknown selling status/latest revision/packing/price/lead time retained.
-- Apply ONCE; no legacy CRM changes, deployment or paid-plan change.
begin;\n${schema}\n${seed}\n${grants}\ncommit;\nselect 'two_product_search_enabled' as result;\n`;
await mkdir(output,{recursive:true});
await writeFile(output+'2026-10-07-products-preview.json',JSON.stringify(preview,null,2));
await writeFile(output+'2026-10-07-products-apply.sql',final);
const tests=await readFile('db/test-product-body.sql','utf8');
await writeFile(output+'2026-10-07-products-rollback.sql',`begin;\n${schema}\n${seed}\n${grants}\n${tests}\nrollback;\nselect 'two_product_search_rollback_passed' as result;\n`);
await writeFile(output+'2026-10-07-products-manifest.json',JSON.stringify({batch_id:batch,count:rows.length,preview_sha256:hash(JSON.stringify(preview,null,2)),apply_sha256:hash(final),sources:rows.map(r=>({pn:r.pn,file:r.spec.source.file,sha256:r.source_sha256})),not_applied:true},null,2));
console.log('Prepared two-product preview, source hashes and exact application SQL. No cloud changes.');

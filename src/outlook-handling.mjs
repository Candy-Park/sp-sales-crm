import {classificationCategories,classificationRoles} from './outlook.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,hash=/^[0-9a-f]{64}$/;
export function reviewedMailPage(mails,owned,decisions,{view,offset,category='all',state='all'}){
 if(!['reviewed','registration-skipped'].includes(view)||!Number.isSafeInteger(offset)||offset<0||!Array.isArray(decisions)||!decisions.length||decisions.length>1000)throw Error('Invalid reviewed list');
 const local=new Map(),receipts=new Map(owned.map(m=>[m.id,m])),classified=new Map(mails.map(m=>[m.id,m]));
 if(receipts.size!==owned.length||classified.size!==mails.length||owned.length!==decisions.length||mails.length!==decisions.length)throw Error('Receipt match unavailable');
 for(const d of decisions){
  if(!uuid.test(d.id)||local.has(d.id)||!['scope_key','source_key','payload_hash'].every(k=>hash.test(d[k]))||typeof d.include!=='boolean'||!/^M20-\d{2}$/.test(d.case_id)||typeof d.reason!=='string'||d.reason.length>300||typeof d.reply_note!=='string'||d.reply_note.length>200||(d.category!==null&&!classificationCategories.includes(d.category))||(d.role!==null&&!classificationRoles.includes(d.role)))throw Error('Invalid reviewed decision');
  if(!receipts.has(d.id)||!classified.has(d.id)||!['scope_key','source_key','payload_hash'].every(k=>receipts.get(d.id)[k]===d[k]))throw Error('Receipt match unavailable');
  local.set(d.id,d);
 }
 const all=mails.map(mail=>{const d=local.get(mail.id);return {...mail,handling:{case_id:d.case_id,include:d.include,category:d.category,role:d.role,reason:d.reason,reply_note:d.reply_note}};});
 const filtered=all.filter(m=>m.handling.include===(view==='reviewed')&&(category==='all'||(m.handling.category??m.category_group)===category)&&(state==='all'||m.classification_state===state)).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||a.id.localeCompare(b.id));
 return {mails:filtered.slice(offset,offset+50),hasMore:filtered.length>offset+50,summary:{reviewed:all.length,business:all.filter(m=>m.handling.include).length,skipped:all.filter(m=>!m.handling.include).length}};
}

// Inputs come only from the authenticated, owner-bound local discovery result.
export async function reconcileEvents(data,query,write){
 let recorded=0,held=data.held||0;const histories=new Map();
 for(const event of data.events||[]){
  try{
   const iid=event.inquiry_id;
   if(!histories.has(iid)){
    const response=await query('/api/inquiries/'+iid);if(!response.ok)throw Error('Inquiry unavailable');
    const detail=await response.json();if(detail.inquiry.id!==iid)throw Error('Inquiry mismatch');
    if(detail.inquiry.status==='closed')histories.set(iid,null);
    else{
     const response=await query(`/api/inquiries/${iid}/communication`);if(!response.ok)throw Error('History unavailable');
     const history=await response.json();if(history.truncated||!Array.isArray(history.messages))throw Error('History incomplete');
     histories.set(iid,new Set(history.messages.map(m=>m.id)));
    }
   }
   const saved=histories.get(iid);if(saved===null){held++;continue;}if(saved.has(event.message.id))continue;
   if(event.message.action_id||event.message.source_id)throw Error('Observation cannot complete or claim draft linkage');
   if(recorded===50)return {recorded,held,incomplete:false,remaining:true};
   const response=await write(`/api/inquiries/${iid}/messages`,event.message);
   if(!response.ok||(await response.json()).result!==event.message.id)throw Error('Save incomplete');
   saved.add(event.message.id);recorded++;
  }catch{return {recorded,held,incomplete:true,message:'메일 처리 이력의 저장 결과를 확인하지 못했습니다. 같은 확인으로 재시도하면 중복 저장을 방지합니다.'};}
 }
 return {recorded,held,incomplete:false};
}
export async function reconcileRequests(analysis,context,local,write){
 let imported=0;
 const pending=(analysis.candidates||[]).filter(c=>c.automatic_registration&&!c.inquiry_id).slice(0,5);
 for(const candidate of pending){
  try{
   const input={...context,source_key:candidate.source_key};
   const plan=await local({...input,mode:'prepare'});
   if(plan.source_key!==candidate.source_key)throw Error('Source mismatch');
   const iid=plan.registration.id;
   for(const [path,body,id] of [['/api/inquiries',plan.registration,iid],[`/api/inquiries/${iid}/actions`,plan.action,plan.action.id],[`/api/inquiries/${iid}/messages`,plan.message,plan.message.id]]){
    const response=await write(path,body);if(!response.ok)throw Error('Save incomplete');
    if((await response.json()).result!==id)throw Error('Receipt mismatch');
   }
   await local({...input,mode:'ack'});imported++;
  }catch{return {imported,incomplete:true,message:'새 요청의 저장을 완료하지 못했습니다. 일부 저장됐을 수 있으므로 같은 요청으로 재확인하세요.'};}
 }
 return {imported,incomplete:false,remaining:Math.max(0,(analysis.candidates||[]).filter(c=>c.automatic_registration&&!c.inquiry_id).length-imported)};
}

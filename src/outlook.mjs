import {id,writeInput} from './write-input.mjs';
const hash=/^[0-9a-f]{64}$/;
export function outlookInput(operation,data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('수집 입력을 확인해주세요.');
  if(operation==='outlook-triage'){
    if(Object.keys(data).sort().join(',')!=='excluded,revision'||typeof data.excluded!=='boolean'||!Number.isInteger(data.revision)||data.revision<1||data.revision>2147483646)throw new Error('업무 제외·복원 입력을 확인해주세요.');
    return {excluded:data.excluded,revision:data.revision};
  }
  if(operation==='outlook-link'){
    if(Object.keys(data).some(k=>!['inquiry_id','registration'].includes(k)))throw new Error('연결 입력을 확인해주세요.');
    if(Boolean(data.inquiry_id)===Boolean(data.registration))throw new Error('신규 또는 기존 문의를 선택해주세요.');
    return data.inquiry_id?{inquiry_id:id(data.inquiry_id)}:{registration:writeInput('register',data.registration)};
  }
  if(Object.keys(data).sort().join(',')!=='body_length,id,original_json,payload_hash,scope_key,source_key')throw new Error('수집 입력을 확인해주세요.');
  id(data.id);
  for(const k of ['scope_key','source_key','payload_hash'])if(!hash.test(data[k]??''))throw new Error('수집 식별자를 확인해주세요.');
  if(!Number.isInteger(data.body_length)||data.body_length<0||data.body_length>10000000||typeof data.original_json!=='string'||data.original_json.length>350000)throw new Error('수집 크기를 확인해주세요.');
  let mail;try{mail=JSON.parse(data.original_json);}catch{throw new Error('수집 원문 형식을 확인해주세요.');}
  if(!mail||typeof mail!=='object'||Object.keys(mail).sort().join(',')!=='attachments,body,conversation_key,direction,identity_method,occurred_at,recipients,sender,source_key,subject')throw new Error('수집 필드를 확인해주세요.');
  if(mail.source_key!==data.source_key||!['received','sent'].includes(mail.direction)||!['internet_message_id','entry_id_fallback'].includes(mail.identity_method))throw new Error('수집 식별자를 확인해주세요.');
  for(const [k,max] of [['subject',1000],['sender',2000],['recipients',10000]])if(typeof mail[k]!=='string'||mail[k].length>max)throw new Error('메일 입력 길이를 확인해주세요.');
  if(!Number.isFinite(Date.parse(mail.occurred_at))||!/(Z|[+-]\d\d:\d\d)$/.test(mail.occurred_at))throw new Error('메일 시각을 확인해주세요.');
  if(mail.conversation_key!==null&&!hash.test(mail.conversation_key??''))throw new Error('대화 식별자를 확인해주세요.');
  if(data.body_length>100000?mail.body!==null:typeof mail.body!=='string'||Array.from(mail.body).length!==data.body_length)throw new Error('원문 보존 정책을 확인해주세요.');
  if(!Array.isArray(mail.attachments)||mail.attachments.length>100||mail.attachments.some(a=>!a||Object.keys(a).sort().join(',')!=='name,size'||typeof a.name!=='string'||!a.name.trim()||a.name.length>1000||!Number.isSafeInteger(a.size)||a.size<0))throw new Error('첨부 메타데이터를 확인해주세요.');
  return data;
}

import {id,time,revision,text,known} from './write-input.mjs';
export const messageKinds=['hq_draft','customer_draft','hq_sent','customer_sent','hq_received','customer_received'];
export function communicationInput(operation,data){
 if(operation==='question'){
  known(data,['id','question']);
  return {id:id(data.id),question:text(data.question,2000,true)};
 }
 if(operation==='review'){
  known(data,['revision','status','response_message_id','note']);
  if(!['open','partial','answered','cancelled'].includes(data.status))throw Error('질문 검토 상태를 확인해주세요.');
  const note=text(data.note??'',2000,data.status!=='open');
  const response=data.response_message_id?id(data.response_message_id):null;
  if(['partial','answered'].includes(data.status)&&!response)throw Error('검토 근거인 HQ 답변 원문을 선택해주세요.');
  if(data.status==='cancelled'&&response)throw Error('질문 취소는 답변 완료와 구분해주세요.');
  return {revision:revision(data.revision),status:data.status,response_message_id:response,note};
 }
 if(operation!=='message')throw Error('지원하지 않는 커뮤니케이션 작업입니다.');
 known(data,['id','kind','target','subject','body','occurred_at','actual_confirmed','source_id','action_id','question_ids','translation','summary']);
 if(!messageKinds.includes(data.kind))throw Error('초안·발송·수신 종류를 확인해주세요.');
 const draft=data.kind.endsWith('_draft'),sent=data.kind.endsWith('_sent');
 const occurred=data.occurred_at?time(data.occurred_at):null;
 if(draft&&occurred||!draft&&!occurred)throw Error('초안에는 발송 시각을 넣지 않고, 실제 발송·수신에는 시각을 기록해주세요.');
 if(occurred&&Date.parse(occurred)>Date.now()+60000)throw Error('실제 발송·수신 시각은 미래로 기록할 수 없습니다.');
 if(sent&&data.actual_confirmed!==true||!sent&&data.actual_confirmed===true)throw Error('실제 발송 기록 여부를 확인해주세요.');
 if(data.actual_confirmed!==undefined&&typeof data.actual_confirmed!=='boolean')throw Error('실제 발송 확인 형식을 확인해주세요.');
 const questions=data.question_ids??[];
 if(!Array.isArray(questions)||questions.length>100||new Set(questions).size!==questions.length)throw Error('연결할 HQ 질문을 확인해주세요.');
 if(questions.length&&!['hq_draft','hq_sent'].includes(data.kind))throw Error('HQ 질문 선택은 HQ 초안·발송에만 사용합니다.');
 if(data.action_id&&!sent)throw Error('발송 준비 Action은 실제 발송을 기록할 때만 완료할 수 있습니다.');
 return {id:id(data.id),kind:data.kind,target:text(data.target,200,true),subject:text(data.subject??'',300),body:text(data.body,100000,true),occurred_at:occurred,actual_confirmed:sent,
  source_id:data.source_id?id(data.source_id):null,action_id:data.action_id?id(data.action_id):null,question_ids:questions.map(id),translation:text(data.translation??'',100000),summary:text(data.summary??'',10000)};
}

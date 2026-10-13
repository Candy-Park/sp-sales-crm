import {handleApi} from './api.mjs';
import {publicConfig} from './public-config.mjs';
import {handleFollowups} from './crm-followups.mjs';
export async function handleCRMBridge(req,res,path,env,origin,handler=handleApi){
 if(!path.startsWith('/api/crm/'))return false;
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){json(403,{error:'허용되지 않은 요청입니다.'});return true;}
 if(path==='/api/crm/config'&&req.method==='GET'){const config=publicConfig(env);json(config?200:503,config?{...config,...(env.remoteOrigin?{cloudMemos:true}:{})}:{error:'CRM 연결 설정을 확인해야 합니다.'});return true;}
 const translated=path.replace('/api/crm/','/api/');
 const reviewedLink=req.method==='POST'&&typeof env.localHandling==='function'&&/^\/api\/outlook\/([0-9a-f-]{36})\/link$/i.exec(translated);
 if(translated.startsWith('/api/outlook')&&!reviewedLink&&(req.method!=='GET'||translated==='/api/outlook/local')){json(404,{error:'메일 수집·변경은 기존 검토 메뉴에서만 처리합니다.'});return true;}
 if(!/^Bearer [A-Za-z0-9._~-]+$/.test(req.headers.authorization??'')||(req.headers.authorization?.length??0)>8192){json(401,{error:'저장된 CRM 업무는 계정 연결 후 확인할 수 있습니다.'});return true;}
 if(!['GET','HEAD'].includes(req.method)&&(req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))){json(403,{error:'현재 CRM 화면에서만 저장할 수 있습니다.'});return true;}
 try{
  let reviewedMail;
  if(reviewedLink){
   // The original API verifies the session, owner and every local receipt/hash.
   // Never authorize writes from the unprotected preview snapshot alone.
   const reviewUrl=new URL('/api/outlook?view=reviewed',origin);
   const reviewed=await handler(new Request(reviewUrl,{headers:req.headers}),env);
   if(!reviewed.ok){res.writeHead(reviewed.status,Object.fromEntries(reviewed.headers));res.end(await reviewed.text());return true;}
   const data=await reviewed.json(),mail=data.mails?.find(m=>m.id===reviewedLink[1]);
   if(data.hasMore||!mail||!mail.handling?.include||mail.excluded||!['pending','linked'].includes(mail.state)){json(403,{error:'소유자와 사용자 검토가 확인된 담당 메일만 연결할 수 있습니다.'});return true;}
   reviewedMail=mail;
  }
  let body;
  if(!['GET','HEAD'].includes(req.method)){const chunks=[];let size=0;for await(const c of req){size+=Buffer.byteLength(c);if(size>800000){json(413,{error:'입력 내용이 너무 큽니다.'});return true;}chunks.push(Buffer.from(c));}body=Buffer.concat(chunks);}
  if(reviewedMail?.handling?.case_id==='M20-10'){
   let payload;try{payload=JSON.parse(body.toString());}catch{json(400,{error:'연결 입력을 확인해주세요.'});return true;}
   if(payload.registration){json(422,{error:'VPN 원문은 새 문의에 복사하지 않습니다. 자격증명이 없는 요약 문의를 먼저 등록한 뒤 기존 문의에 연결하세요.'});return true;}
  }
  const target=new URL(req.url,origin);target.pathname=translated;
  if(translated==='/api/followups'){
   const response=await handleFollowups(new Request(target,{method:req.method,headers:req.headers,body}),env,handler);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return true;
  }
  const response=await handler(new Request(target,{method:req.method,headers:req.headers,body}),env);
  const mailDetail=req.method==='GET'&&/^\/api\/outlook\/([0-9a-f-]{36})$/i.exec(translated);
  if(response.ok&&mailDetail&&env.redactedMailIds?.has(mailDetail[1])){
   const data=await response.json();
   if(data.mail?.original)data.mail.original={...data.mail.original,body:'VPN 관련 원문은 보안상 표시하지 않습니다. 자격증명이 없는 요약 문의에 연결해 처리 이력을 보존합니다.'};
   json(response.status,data);return true;
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch{json(503,{error:'CRM 연결을 확인하지 못했습니다. 입력을 유지하고 다시 시도하세요.'});}
 return true;
}

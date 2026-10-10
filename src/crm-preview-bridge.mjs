import {handleApi} from './api.mjs';
import {publicConfig} from './public-config.mjs';
export async function handleCRMBridge(req,res,path,env,origin,handler=handleApi){
 if(!path.startsWith('/api/crm/'))return false;
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){json(403,{error:'허용되지 않은 요청입니다.'});return true;}
 if(path==='/api/crm/config'&&req.method==='GET'){const config=publicConfig(env);json(config?200:503,config||{error:'CRM 연결 설정을 확인해야 합니다.'});return true;}
 const translated=path.replace('/api/crm/','/api/');
 if(translated.startsWith('/api/outlook')&&(req.method!=='GET'||translated==='/api/outlook/local')){json(404,{error:'메일 수집·변경은 기존 검토 메뉴에서만 처리합니다.'});return true;}
 if(!/^Bearer [A-Za-z0-9._~-]+$/.test(req.headers.authorization??'')||(req.headers.authorization?.length??0)>8192){json(401,{error:'저장된 CRM 업무는 계정 연결 후 확인할 수 있습니다.'});return true;}
 if(!['GET','HEAD'].includes(req.method)&&(req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))){json(403,{error:'현재 CRM 화면에서만 저장할 수 있습니다.'});return true;}
 try{
  let body;
  if(!['GET','HEAD'].includes(req.method)){const chunks=[];let size=0;for await(const c of req){size+=Buffer.byteLength(c);if(size>800000){json(413,{error:'입력 내용이 너무 큽니다.'});return true;}chunks.push(Buffer.from(c));}body=Buffer.concat(chunks);}
  const target=new URL(req.url,origin);target.pathname=translated;
  const response=await handler(new Request(target,{method:req.method,headers:req.headers,body}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch{json(503,{error:'CRM 연결을 확인하지 못했습니다. 입력을 유지하고 다시 시도하세요.'});}
 return true;
}

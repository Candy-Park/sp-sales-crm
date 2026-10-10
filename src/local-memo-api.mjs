import {MemoError} from './local-memos.mjs';
export async function handleLocalMemos(req,res,path,store,origin){
 if(path!=='/api/memos'&&!path.startsWith('/api/memos/'))return false;
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){json(403,{error:'허용되지 않은 요청입니다.'});return true;}
 try{
  if(req.method==='GET'&&path==='/api/memos'){json(200,{memos:store.list()});return true;}
  const id=/^\/api\/memos\/([0-9a-f-]{36})$/i.exec(path)?.[1];
  if(!((req.method==='POST'&&path==='/api/memos')||(req.method==='PATCH'&&id))){json(405,{error:'지원하지 않는 메모 요청입니다.'});return true;}
  if(req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')){json(403,{error:'현재 CRM 화면에서만 메모를 저장할 수 있습니다.'});return true;}
  let bytes=0,chunks=[];for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>65536){json(413,{error:'메모 요청이 너무 큽니다.'});return true;}chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8'));}catch{json(400,{error:'메모 입력을 확인하세요.'});return true;}
  json(req.method==='POST'?201:200,{memo:req.method==='POST'?store.create(body):store.update(id,body)});
 }catch(error){json(error instanceof MemoError?error.status:503,{error:error instanceof MemoError?error.message:'메모를 저장하지 못했습니다. 입력을 유지하고 다시 시도하세요.'});}
 return true;
}

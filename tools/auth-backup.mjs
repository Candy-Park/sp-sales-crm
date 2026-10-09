import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const origin='http://127.0.0.1:4323',host='127.0.0.1:4323';
const cli='D:/AI/cache/npm-sp-sales-crm/_npx/0e23c24576954b26/node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
const dbUrl='postgresql://postgres.glscckjmlwvxilzneqdf@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require';
export function validateSubmission(headers,body,nonce){
 const reject=()=>{throw new Error('Private local submission required');};
 if(headers.host!==host||headers.origin!==origin||!headers['content-type']?.startsWith('application/x-www-form-urlencoded')||Buffer.byteLength(body)>4096)reject();
 const form=new URLSearchParams(body),given=form.get('nonce');
 if(form.getAll('nonce').length!==1||!given||given.length!==nonce.length||!timingSafeEqual(Buffer.from(given),Buffer.from(nonce)))reject();
 if([...form.keys()].some(key=>!['nonce','password'].includes(key))||form.getAll('password').length!==1)reject();
 const password=form.get('password');if(!password||password.length>1024)reject();return password;
}
export function dumpJobs(directory,password){
 return [['roles.sql',['--role-only']],['schema.sql',[]],['data.sql',['--data-only','--use-copy']]].map(([file,flags])=>({
  file:join(directory,file),args:['db','dump','--db-url',dbUrl,'--file',join(directory,file),...flags,'--log-level','none'],
  env:{SUPABASE_DB_PASSWORD:password,PGPASSWORD:password},
 }));
}
function run(job,workdir){
 return new Promise((ok,fail)=>{
  const child=spawn(cli,[...job.args,'--workdir',workdir],{env:{...process.env,...job.env},cwd:workdir,stdio:'ignore',windowsHide:true});
  const timer=setTimeout(()=>{child.kill();fail(new Error('CLI timeout'));},240000);
  child.on('error',()=>{clearTimeout(timer);fail(new Error('CLI unavailable'));});
  child.on('exit',code=>{clearTimeout(timer);code===0?ok():fail(new Error('CLI export failed'));});
 });
}
async function main(){
 const directory=resolve(process.argv[2]??''),workdir=resolve(process.argv[3]??'');
 for(const [path,root] of [[directory,'D:/AI/projects/sp-sales-crm/sources'],[workdir,'D:/AI/projects/sp-sales-crm/scratch']]){
  const rel=relative(resolve(root),path);if(!rel||rel.startsWith('..')||isAbsolute(rel)||!(await stat(path)).isDirectory())throw new Error('Prepared private project directory required');
 }
 const nonce=randomBytes(32).toString('hex');let busy=false,used=false;
 let state={phase:'ready',message:'sp-sales-crm 프로젝트의 DB 비밀번호를 입력하세요. 기존 프로젝트에서 읽기 전용 SQL 백업을 만들며 운영 DB는 수정하지 않습니다.'};
 const page=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CRM 인증 복원 · 비공개 입력</title><link rel="stylesheet" href="/style.css"><main><h1>CRM 인증 복원 검수</h1><p>프로젝트: sp-sales-crm (glscckjmlwvxilzneqdf)</p><p>Supabase 프로젝트의 DB 비밀번호입니다. CRM 로그인 비밀번호와 구분하세요.</p><form id="form"><label for="password">DB 비밀번호</label><input id="password" type="password" autocomplete="off" required maxlength="1024"><button id="submit">읽기 전용 백업 시작</button></form><p id="status" role="status"></p><p>비밀번호는 파일·로그에 저장하지 않습니다. 백업은 사용자만 접근하는 D 드라이브 폴더에 저장합니다. 백업 후 별도 로컬 DB에 복원하며, 운영 데이터·기존 가상 DB는 바꾸지 않습니다.</p></main><script src="/form.js"></script></html>`;
 const script=`const form=document.getElementById('form'),field=document.getElementById('password'),button=document.getElementById('submit'),status=document.getElementById('status');async function update(){const data=await(await fetch('/status',{cache:'no-store'})).json();status.textContent=data.message;if(data.phase!=='ready')button.disabled=true;}form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;const body=new URLSearchParams({nonce:'${nonce}',password:field.value});field.value='';try{const response=await fetch('/backup',{method:'POST',body});body.delete('password');if(!response.ok)status.textContent='요청을 받지 못했습니다. 담당 에이전트에게 알려주세요.';await update();}catch{body.delete('password');status.textContent='연결을 확인하지 못했습니다.';}});update();setInterval(update,2000);`;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==origin)){res.writeHead(403);res.end();return;}
  if(req.method==='GET'&&req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return;}
  if(req.method==='GET'&&['/','/form.js','/style.css'].includes(req.url)){
   res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':req.url==='/form.js'?'text/javascript; charset=utf-8':'text/css');
   res.end(req.url==='/'?page:req.url==='/form.js'?script:'body{font:18px system-ui;background:#f2f5f8;color:#172536}main{max-width:660px;margin:8vh auto;background:white;padding:36px;border-radius:16px}label,input,button{display:block}input{width:95%;padding:12px;margin:10px 0}button{padding:12px 20px}p{line-height:1.6}');return;
  }
  if(req.method!=='POST'||req.url!=='/backup'){res.writeHead(405);res.end();return;}
  if(busy||used){res.writeHead(409);res.end();return;}
  let body='',password;try{
   for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>4096)throw new Error('Too large');}
   password=validateSubmission(req.headers,body,nonce);body='';
  }catch{body='';res.writeHead(400);res.end();return;}
  busy=used=true;state={phase:'running',message:'읽기 전용 백업 진행 중입니다. 이 화면을 유지하세요.'};res.writeHead(202);res.end();
  const jobs=dumpJobs(directory,password);password=undefined;
  try{
   const files=[];
   for(const job of jobs){await run(job,workdir);job.env.SUPABASE_DB_PASSWORD=job.env.PGPASSWORD='';const bytes=await readFile(job.file);if(!bytes.length)throw new Error('Empty backup');files.push({file:job.file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
   await writeFile(join(directory,'manifest.json'),JSON.stringify({project:'glscckjmlwvxilzneqdf',created_at:new Date().toISOString(),files},null,2),{flag:'wx'});
   state={phase:'exported',message:'SQL 백업 3개와 체크섬 기록을 생성했습니다. 아직 복원 검수 완료는 아닙니다. 에이전트에게 백업 완료를 알려주세요.'};
  }catch{state={phase:'failed',message:'백업을 완료하지 못했습니다. 비밀번호는 보관하지 않았습니다. 에이전트가 원인을 확인한 뒤 다시 안내합니다.'};}
  finally{for(const job of jobs)job.env.SUPABASE_DB_PASSWORD=job.env.PGPASSWORD='';busy=false;}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.listen(4323,'127.0.0.1',()=>console.log('Private Auth backup input ready on 127.0.0.1:4323'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Private backup input setup failed');process.exitCode=1;});

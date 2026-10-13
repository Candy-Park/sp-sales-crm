// Project-local launcher. No scheduled task, global setting or credential storage.
import {spawn} from 'node:child_process';
import {openSync,closeSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.CRM_LOCAL_PORT||4327);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('올바른 로컬 포트를 지정하세요.');
const address='http://127.0.0.1:'+port+'/';
async function state(){
 try{
  const response=await fetch(address,{signal:AbortSignal.timeout(1200)});
  if(!response.ok)return 'other';
  const page=await response.text();return page.includes('Sales CRM')&&page.includes('Source Photonics')?'ready':'other';
 }catch{return 'offline';}
}
async function start(){
 const before=await state();
 if(before==='other')throw Error(port+' 포트를 다른 프로그램이 사용 중입니다. 기존 프로그램은 종료하지 않았습니다.');
 if(before==='ready'){console.log('CRM 서버가 이미 실행 중입니다. '+address);return;}
 for(const path of ['.env','dist/style.css','dist/bootstrap.css','D:/AI/projects/sp-sales-crm/scratch/handling-preview-20261009/index.html','D:/AI/projects/sp-sales-crm/scratch/handling-preview-20261009/app.js','D:/AI/projects/sp-sales-crm/scratch/handling-preview-20261009/snapshot.json']){
  if(!existsSync(resolve(root,path)))throw Error('CRM 실행 자료가 준비되지 않았습니다. 프로젝트의 빌드·로컬 검토 자료를 확인하세요.');
 }
 const output=openSync(resolve(root,'notes/followup-server.stdout.log'),'w');
 const errors=openSync(resolve(root,'notes/followup-server.stderr.log'),'w');
 try{
  const child=spawn(process.execPath,['--env-file-if-exists=.env','tools/handling-preview-server.mjs'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',output,errors]});
  child.unref();
  let failed=false;child.on('error',()=>{failed=true;});
  for(let attempt=0;attempt<20;attempt++){
   if(failed)throw Error('CRM 서버를 실행하지 못했습니다.');
   if(await state()==='ready'){console.log('CRM 서버를 실행했습니다. '+address);return;}
   await new Promise(done=>setTimeout(done,250));
  }
  throw Error('CRM 서버의 시작을 확인하지 못했습니다. 로컬 서버 기록을 확인하세요.');
 }finally{closeSync(output);closeSync(errors);}
}
try{await start();}catch(error){console.error(error.message);process.exitCode=1;}

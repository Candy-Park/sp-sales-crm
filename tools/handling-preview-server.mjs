import {handleCRMBridge} from '../src/crm-preview-bridge.mjs';
import {localHandling,localFollowups} from './outlook-local.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {reviewedMailPage} from '../src/outlook-handling.mjs';
import {openMemoStore} from '../src/local-memos.mjs';
import {handleLocalMemos} from '../src/local-memo-api.mjs';
const config={SUPABASE_URL:process.env.SUPABASE_URL??'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY??''};
config.localHandling=localHandling;
config.localFollowups=localFollowups;
const origin='http://127.0.0.1:4327';
const directory='D:/AI/projects/sp-sales-crm/scratch/handling-preview-20261009/';
const snapshot=JSON.parse(await readFile(directory+'snapshot.json','utf8'));
config.localWorkReview=id=>snapshot.classified.find(m=>m.id===id)?.work_review;
config.redactedMailIds=new Set(snapshot.decisions.filter(d=>d.case_id==='M20-10').map(d=>d.id));
const memoDirectory='D:/AI/projects/sp-sales-crm/sources/memos/';
await mkdir(memoDirectory,{recursive:true});
const memos=openMemoStore(memoDirectory+'memos.sqlite');
// Confirm the same receipt matching used by the authenticated production route.
reviewedMailPage(snapshot.classified,snapshot.owned,snapshot.decisions,{view:'reviewed',offset:0});
const files=new Map([['/',[directory+'index.html','text/html; charset=utf-8']],['/app.js',[directory+'app.js','text/javascript; charset=utf-8']],['/style.css',['dist/style.css','text/css']],['/bootstrap.css',['dist/bootstrap.css','text/css']],['/assets/sp-logo-transparent.png',['dist/assets/sp-logo-transparent.png','image/png']]]);
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://glscckjmlwvxilzneqdf.supabase.co; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.headers.host!=='127.0.0.1:4327'||(req.headers.origin&&req.headers.origin!==origin)){json(403,{error:'허용되지 않은 요청입니다.'});return;}
 try{
  const url=new URL(req.url,origin),path=url.pathname;
  if(await handleCRMBridge(req,res,path,config,origin))return;
  if(await handleLocalMemos(req,res,path,memos,origin))return;
  if(req.method!=='GET'){json(405,{error:'메일과 업무 조회는 읽기 전용입니다.'});return;}
  if(path==='/api/outlook/local'){json(200,snapshot.status);return;}
  if(path==='/api/outlook'){
   const view=url.searchParams.get('view')??'active',offset=Number(url.searchParams.get('offset')??0),category=url.searchParams.get('category')??'all',state=url.searchParams.get('classification')??'all';
   if(!Number.isSafeInteger(offset)||offset<0){json(400,{error:'페이지를 확인하세요.'});return;}
   if(['reviewed','registration-skipped'].includes(view)){json(200,reviewedMailPage(snapshot.classified,snapshot.owned,snapshot.decisions,{view,offset,category,state}));return;}
   if(!['active','excluded','all'].includes(view)){json(400,{error:'목록을 확인하세요.'});return;}
   const rows=snapshot.classified.filter(m=>(view==='all'||m.excluded===(view==='excluded'))&&(category==='all'||m.category_group===category)&&(state==='all'||m.classification_state===state));json(200,{mails:rows.slice(offset,offset+50),hasMore:rows.length>offset+50});return;
  }
  const detail=/^\/api\/outlook\/([0-9a-f-]{36})$/.exec(path);
  if(detail){const mail=snapshot.classified.find(m=>m.id===detail[1]);if(!mail){json(404,{error:'메일을 찾을 수 없습니다.'});return;}json(200,{mail:{...mail,original:snapshot.originals[mail.id]}});return;}
  if(path==='/api/lookups'){json(200,{customers:[]});return;}
  if(path==='/api/inquiries'){json(200,{inquiries:[],hasMore:false});return;}
  const file=files.get(path);if(!file){json(404,{error:'요청한 기능이 없습니다.'});return;}
  res.setHeader('Content-Type',file[1]);res.end(await readFile(file[0]));
 }catch{json(503,{error:'미리보기 데이터를 확인하지 못했습니다.'});}
}).listen(4327,'127.0.0.1',()=>console.log('CRM task preview with local memos ready on 127.0.0.1:4327'));

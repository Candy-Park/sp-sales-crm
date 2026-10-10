import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
export class MemoError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new MemoError(status,message);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function input(value,partial=false){
 if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'메모 입력을 확인하세요.');
 const keys=Object.keys(value),allowed=partial?['content','category','dueDate','completed']:['content','category','dueDate'];
 if(!keys.length||keys.some(k=>!allowed.includes(k))||(!partial&&allowed.some(k=>!keys.includes(k))))fail(400,'메모 입력을 확인하세요.');
 const normalized={};
 if('content'in value){if(typeof value.content!=='string'||!value.content.trim()||value.content.length>10000||value.content.includes('\0'))fail(400,'메모는 1~10,000자로 입력하세요.');normalized.content=value.content.trim();}
 if('category'in value){if(!['personal','work'].includes(value.category))fail(400,'개인 또는 업무 구분을 선택하세요.');normalized.category=value.category;}
 if('dueDate'in value){const d=value.dueDate;if(d!==null&&(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))fail(400,'올바른 기한을 입력하세요.');normalized.dueDate=d;}
 if('completed'in value){if(typeof value.completed!=='boolean')fail(400,'완료 여부를 확인하세요.');normalized.completed=value.completed;}
 return normalized;
}
export function openMemoStore(path){
 const db=new DatabaseSync(path);db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS memos(id TEXT PRIMARY KEY,content TEXT NOT NULL,category TEXT NOT NULL,dueDate TEXT,completedAt TEXT,revision INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memo_history(memo_id TEXT NOT NULL REFERENCES memos(id),revision INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(memo_id,revision));
 CREATE TABLE IF NOT EXISTS memo_requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,response TEXT NOT NULL);`);
 const row=id=>db.prepare('SELECT * FROM memos WHERE id=?').get(id);
 function mutate(kind,id,body){
  const expected=kind==='create'?['requestId','input']:['requestId','revision','patch'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==expected.length||expected.some(k=>!(k in body))||!uuid.test(body.requestId))fail(400,'저장 요청을 확인하세요.');
  const payload=input(kind==='create'?body.input:body.patch,kind!=='create');
  if(kind!=='create'&&(!uuid.test(id)||!Number.isSafeInteger(body.revision)||body.revision<1))fail(400,'메모 버전을 확인하세요.');
  const hash=createHash('sha256').update(JSON.stringify({kind,id,payload,revision:body.revision})).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try{
   const prior=db.prepare('SELECT hash,response FROM memo_requests WHERE id=?').get(body.requestId);
   if(prior){if(prior.hash!==hash)fail(409,'같은 저장 요청에 다른 내용이 들어왔습니다.');db.exec('COMMIT');return JSON.parse(prior.response);}
   const now=new Date().toISOString();let memo;
   if(kind==='create')memo={id:randomUUID(),...payload,completedAt:null,revision:1,createdAt:now,updatedAt:now};
   else{const previous=row(id);if(!previous)fail(404,'메모를 찾지 못했습니다.');if(previous.revision!==body.revision)fail(409,'다른 화면에서 수정되었습니다. 입력은 유지됩니다. 새로고침 후 최신 내용을 확인하세요.');memo={...previous,...payload,revision:previous.revision+1,updatedAt:now};if('completed'in payload){memo.completedAt=payload.completed?(previous.completedAt||now):null;delete memo.completed;}}
   db.prepare('INSERT INTO memos VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,category=excluded.category,dueDate=excluded.dueDate,completedAt=excluded.completedAt,revision=excluded.revision,updatedAt=excluded.updatedAt').run(memo.id,memo.content,memo.category,memo.dueDate,memo.completedAt,memo.revision,memo.createdAt,memo.updatedAt);
   db.prepare('INSERT INTO memo_history VALUES(?,?,?)').run(memo.id,memo.revision,JSON.stringify(memo));
   db.prepare('INSERT INTO memo_requests VALUES(?,?,?)').run(body.requestId,hash,JSON.stringify(memo));db.exec('COMMIT');return memo;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {list:()=>db.prepare('SELECT * FROM memos ORDER BY createdAt DESC,id DESC').all(),create:body=>mutate('create',null,body),update:(id,body)=>mutate('update',id,body),close:()=>db.close()};
}

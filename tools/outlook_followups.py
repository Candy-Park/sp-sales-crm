"""Bounded linked-thread collection, local originals only; no tokens or cloud writes."""
import hashlib,json,sqlite3,subprocess,sys,tempfile,uuid
from contextlib import closing
from datetime import datetime,timedelta,timezone
from pathlib import Path
from outlook_outbox import Outbox,canonical,date,digest,valid_mail
from outlook_workflow import propose
from outlook_review import newest_text
import re

ORIGINAL=Path('D:/AI/projects/sp-sales-crm/sources/outlook/outbox.sqlite')
DESTINATION=Path('D:/AI/projects/sp-sales-crm/sources/outlook/followups.sqlite')
SCRATCH=ORIGINAL.parent/'.followup-temp'
FIELDS={'id','scope_key','source_key','payload_hash','inquiry_id','category','reviewed_at'}

def linked_keys(path,owner,mail_id,base_key):
 keys={base_key} if base_key else set()
 if not Path(path).exists():return keys
 with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as c:
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  for table in ['followup_aliases','followup_links']:
   if c.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?',('table',table)).fetchone():
    for row in c.execute('SELECT conversation_key FROM '+table+' WHERE mail_id=?',(mail_id,)):digest(row[0]);keys.add(row[0])
 return keys

def expand_keys(keys,nodes):
 if not isinstance(nodes,list) or len(nodes)>5000:raise ValueError('Invalid reply graph')
 for node in nodes:
  if set(node)!={'conversation_key','message_key','reply_keys'} or not isinstance(node['reply_keys'],list) or len(node['reply_keys'])>500:raise ValueError('Invalid reply graph')
  for value in [node['conversation_key'],node['message_key'],*node['reply_keys']]:digest(value)
 keys=set(keys);messages=set()
 for _ in range(50):
  before=(len(keys),len(messages))
  for node in nodes:
   if node['conversation_key'] in keys or messages.intersection(node['reply_keys']):keys.add(node['conversation_key']);messages.add(node['message_key'])
  if before==(len(keys),len(messages)):return keys
 raise ValueError('Reply graph depth')

def analyze(original,destination,owner,targets):
 selected=seeds(original,owner,targets);results=[]
 for t,base,_ in selected:
  keys=linked_keys(destination,owner,t['id'],base['conversation_key'])
  context={}
  for path in [original,destination]:
   if not Path(path).exists():continue
   with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as c:
    c.execute('BEGIN')
    if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
    window=c.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?',(t['scope_key'],)).fetchone()
    if not window:continue
    rows=c.execute("SELECT source_key,payload,payload_hash FROM mail_outbox WHERE scope_key=? AND json_extract(payload,'$.conversation_key') IN ("+','.join('?' for _ in keys)+') LIMIT 1001',(t['scope_key'],*sorted(keys))).fetchall() if keys else []
    if len(rows)>1000:raise ValueError('Thread limit')
    for key,payload,hashed in rows:
     if hashlib.sha256(payload.encode()).hexdigest()!=hashed:raise ValueError('Original conflict')
     mail=valid_mail(json.loads(payload),date(window[0]),date(window[1]))
     if mail['source_key']!=key:raise ValueError('Source mismatch')
     if key in context and canonical(context[key])!=payload:raise ValueError('Original conflict')
     context[key]=mail
  context.setdefault(base['source_key'],base)
  ordered=sorted(context.values(),key=lambda m:date(m['occurred_at']))
  timeline=[]
  for m in ordered[-12:]:
   top=newest_text(m['body']);held=len(m['body'])>100000 or bool(re.search(r'(?i)password|passwd|secret\s*key|access\s*token|비밀번호|암호\s*[:：]|PRIVATE KEY',top))
   timeline.append(dict(source_key=m['source_key'],occurred_at=m['occurred_at'],direction=m['direction'],excerpt='' if held else top[:1200],held=held,truncated=not held and len(top)>1200))
  latest=ordered[-1];top=newest_text(latest['body']);proposal=propose(latest,ordered,t['category'])
  products=[] if timeline[-1]['held'] else sorted(set(re.findall(r'\b[A-Z][A-Z0-9]{1,8}(?:-[A-Z0-9]{1,12}){2,}\b',top)))[:10]
  if products and proposal['stage']=='요청 후보':proposal['next_action']='추가 요청 제품('+', '.join(products)+')의 사양·자료와 기존 고객 회신 범위를 대조하고 필요한 HQ 확인 또는 고객 회신을 기록'
  results.append(dict(mail_id=t['id'],inquiry_id=t['inquiry_id'],total=len(ordered),received=sum(m['direction']=='received' for m in ordered),sent=sum(m['direction']=='sent' for m in ordered),timeline=timeline,omitted=max(0,len(ordered)-12),product_mentions=products,proposal=proposal,auto_apply=False))
 return dict(threads=results,auto_apply=False,cloud_uploaded=0)

def seeds(path,owner,targets):
 uuid.UUID(owner)
 if not isinstance(targets,list) or not 1<=len(targets)<=50:raise ValueError('Invalid targets')
 result=[];seen=set()
 with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as c:
  c.execute('BEGIN')
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  for t in targets:
   if set(t)!=FIELDS or t['id'] in seen or t['category'] not in {'고객 업무','HQ 업무'}:raise ValueError('Invalid target')
   uuid.UUID(t['id']);uuid.UUID(t['inquiry_id']);date(t['reviewed_at']);seen.add(t['id'])
   for k in ['scope_key','source_key','payload_hash']:digest(t[k])
   row=c.execute('SELECT payload,payload_hash,receipt FROM mail_outbox WHERE scope_key=? AND source_key=?',(t['scope_key'],t['source_key'])).fetchone()
   if not row or hashlib.sha256(row[0].encode()).hexdigest()!=row[1] or row[1]!=t['payload_hash']:raise ValueError('Source mismatch')
   if json.loads(row[2] or 'null')!={k:t[k] for k in ['id','source_key','payload_hash']}:raise ValueError('Receipt mismatch')
   mail=json.loads(row[0]);window=c.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?',(t['scope_key'],)).fetchone()
   if not window or len(mail['body'])>100000:raise ValueError('Held source')
   result.append((t,mail,window))
 if len({t['scope_key'] for t,_,_ in result})!=1:raise ValueError('Mixed mailbox')
 return result

def read_report(original,destination,owner,targets):
 selected=seeds(original,owner,targets)
 result=dict(ready=False,last_checked_at=None,checked_start=None,checked_end=None,stored_records=0,updates=[],auto_apply=False,cloud_uploaded=0)
 if not Path(destination).exists():return result
 with closing(sqlite3.connect(Path(destination).resolve().as_uri()+'?mode=ro',uri=True)) as c:
  c.execute('BEGIN')
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  state=c.execute('SELECT last_capture_at,window_start,window_end FROM capture_state WHERE scope_key=?',(selected[0][0]['scope_key'],)).fetchone()
  if state:result.update(ready=True,last_checked_at=state[0],checked_start=state[1],checked_end=state[2])
  result['stored_records']=c.execute('SELECT count(*) FROM mail_outbox').fetchone()[0]
  for t,base,window in selected:
   review=c.execute('SELECT inquiry_id,reviewed_at FROM followup_reviews WHERE mail_id=?',(t['id'],)).fetchone()
   if review and review[0]!=t['inquiry_id']:raise ValueError('Inquiry changed')
   # Editing CRM does not prove that Outlook was checked up to that time.
   cutoff=min(date(review[1] if review else t['reviewed_at']),date(window[1])).isoformat()
   keys=linked_keys(destination,owner,t['id'],base['conversation_key'])
   context=[json.loads(r[0]) for r in c.execute("SELECT payload FROM mail_outbox WHERE scope_key=? AND json_extract(payload,'$.conversation_key') IN ("+','.join('?' for _ in keys)+') LIMIT 1001',(t['scope_key'],*sorted(keys)))] if keys else []
   if len(context)>1000:raise ValueError('Thread limit')
   later=sorted([m for m in context if date(m['occurred_at'])>date(cutoff)],key=lambda m:date(m['occurred_at']))
   item=dict(mail_id=t['id'],inquiry_id=t['inquiry_id'],reviewed_at=cutoff,later_sent=sum(m['direction']=='sent' for m in later),later_received=sum(m['direction']=='received' for m in later),latest_at=later[-1]['occurred_at'] if later else None,conversation_missing=not base['conversation_key'])
   if later:item['proposal']=propose(later[-1],later,t['category'])
   result['updates'].append(item)
 return result

def scan(original,destination,owner,targets,capture,now=None):
 selected=seeds(original,owner,targets);now=(now or datetime.now(timezone.utc)).replace(second=0,microsecond=0)
 scope=selected[0][0]['scope_key'];groups={t['id']:linked_keys(destination,owner,t['id'],m['conversation_key']) for t,m,_ in selected};keys=set().union(*groups.values())
 if not keys:raise ValueError('No conversation identifiers')
 start=min(date(w[0]) for _,_,w in selected)
 cached=read_report(original,destination,owner,targets)
 if cached['checked_end']:
  with closing(sqlite3.connect(Path(destination).resolve().as_uri()+'?mode=ro',uri=True)) as c:
   covered={row[0] for row in c.execute('SELECT mail_id FROM followup_reviews')}
   graph_ready=c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='followup_links'").fetchone()
   groups_covered=bool(graph_ready) and all(group.issubset({r[0] for r in c.execute('SELECT conversation_key FROM followup_links WHERE mail_id=?',(mid,))}) for mid,group in groups.items())
  if groups_covered and all(t['id'] in covered for t,_,_ in selected):start=max(start,date(cached['checked_end'])-timedelta(minutes=5))
 if start>=now:raise ValueError('No elapsed capture window')
 batch=capture(scope,start.isoformat(),now.isoformat(),keys)
 nodes=batch.pop('conversation_links',[])
 groups={mid:expand_keys(group,nodes) for mid,group in groups.items()};keys=set().union(*groups.values())
 if batch['scope_key']!=scope or date(batch['start'])!=start or date(batch['end'])!=now:raise ValueError('Capture bounds changed')
 with closing(sqlite3.connect(Path(original).resolve().as_uri()+'?mode=ro',uri=True)) as c:
  for m in batch['records']:
   if m.get('conversation_key') not in keys:raise ValueError('Unrelated conversation')
   old=c.execute('SELECT payload_hash FROM mail_outbox WHERE scope_key=? AND source_key=?',(scope,m['source_key'])).fetchone()
   if old and old[0]!=hashlib.sha256(canonical(m).encode()).hexdigest():raise ValueError('Original conflict')
 box=Outbox(destination)
 try:
  box.bind_owner(owner)
  with box.connection:
   box.connection.execute('CREATE TABLE IF NOT EXISTS followup_reviews(mail_id TEXT PRIMARY KEY,inquiry_id TEXT NOT NULL,reviewed_at TEXT NOT NULL)')
   box.connection.execute('CREATE TABLE IF NOT EXISTS followup_links(mail_id TEXT NOT NULL,conversation_key TEXT NOT NULL,PRIMARY KEY(mail_id,conversation_key))')
  # stage validates every source/date/direction and atomically preserves originals.
  box.stage(batch)
  with box.connection:
   for t,_,_ in selected:box.connection.execute('INSERT OR IGNORE INTO followup_reviews VALUES(?,?,?)',(t['id'],t['inquiry_id'],t['reviewed_at']))
   for mid,group in groups.items():
    for key in group:box.connection.execute('INSERT OR IGNORE INTO followup_links VALUES(?,?)',(mid,key))
 finally:box.close()
 return read_report(original,destination,owner,targets)

def capture(scope,start,end,keys):
 SCRATCH.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='scan-',dir=SCRATCH) as folder:
  output=Path(folder)/'capture.json'
  seoul=timezone(timedelta(hours=9))
  local_start=date(start).astimezone(seoul).strftime('%Y-%m-%dT%H:%M:%S');local_end=date(end).astimezone(seoul).strftime('%Y-%m-%dT%H:%M:%S')
  result=subprocess.run(['powershell.exe','-NoProfile','-File',str(Path(__file__).with_name('outlook_collect_scope.ps1')),'-ScopeKey',scope,'-Start',local_start,'-End',local_end,'-OutputPath',str(output),'-CaptureConversations',','.join(sorted(keys))],capture_output=True,timeout=180)
  if result.returncode:raise ValueError('Outlook capture unavailable')
  batch=json.loads(output.read_text(encoding='utf-8-sig'));links=Path(str(output)+'.links.json')
  if links.exists():batch['conversation_links']=json.loads(links.read_text(encoding='utf-8-sig'))
  return batch

if __name__=='__main__':
 try:
  config=json.loads(sys.stdin.read(40000))
  if set(config)!={'mode','owner','targets'} or config['mode'] not in {'status','refresh','analysis'}:raise ValueError('Invalid mode')
  if config['mode']=='analysis':result=analyze(ORIGINAL,DESTINATION,config['owner'],config['targets'])
  elif config['mode']=='refresh':result=scan(ORIGINAL,DESTINATION,config['owner'],config['targets'],capture)
  else:result=read_report(ORIGINAL,DESTINATION,config['owner'],config['targets'])
  print(json.dumps(result,ensure_ascii=False))
 except Exception:sys.exit(1) # Never print mail bodies, credentials or raw subprocess errors.

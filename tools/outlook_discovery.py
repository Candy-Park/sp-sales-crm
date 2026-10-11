"""Owner-bound local new-request discovery. No mail sending or paid AI calls."""
import hashlib,json,re,sqlite3,uuid
from pathlib import Path
from contextlib import closing
from datetime import timedelta,datetime,timezone
from outlook_outbox import Outbox,canonical,date,digest,valid_mail
from outlook_review import review,newest_text,domain_of
from outlook_workflow import propose

DESTINATION=Path('D:/AI/projects/sp-sales-crm/sources/outlook/discovery.sqlite')
SETTINGS=Path('notes/outlook-review-expanded-settings.json')
SENSITIVE=re.compile(r'password|passwd|secret\s*key|access\s*token|비밀번호|암호\s*[:：]|PRIVATE KEY',re.I)
def load_settings():
 settings=json.loads(SETTINGS.read_text(encoding='utf-8-sig'))
 aliases=Path('notes/confirmed-customer-aliases.json')
 if aliases.exists():
  extra=json.loads(aliases.read_text(encoding='utf-8-sig')).get('customers',[]);names={c['name'] for c in settings.get('customers',[])}
  settings['customers']=[*settings.get('customers',[]),*(c for c in extra if c['name'] not in names)]
 return settings
def local_sources(path,owner,iid,mail_id):
 uuid.UUID(owner);uuid.UUID(iid)
 if mail_id:uuid.UUID(mail_id)
 if not Path(path).exists():return {'mails':[]}
 with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as c:
  c.execute('BEGIN')
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  if not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discovery_imports'").fetchone():return {'mails':[]}
  imported=c.execute('SELECT source_key FROM discovery_imports WHERE inquiry_id=?',(iid,)).fetchall()
  if len(imported)!=1:return {'mails':[]}
  key=imported[0][0];rows=c.execute('SELECT scope_key,payload,payload_hash FROM mail_outbox WHERE source_key=?',(key,)).fetchall()
  if len(rows)!=1:raise ValueError('Original missing')
  scope,payload,hashed=rows[0]
  if hashlib.sha256(payload.encode()).hexdigest()!=hashed:raise ValueError('Original mismatch')
  base=json.loads(payload);window=c.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
  records=c.execute("SELECT payload,payload_hash FROM mail_outbox WHERE scope_key=? AND (source_key=? OR json_extract(payload,'$.conversation_key')=?) ORDER BY json_extract(payload,'$.occurred_at') DESC LIMIT 1001",(scope,key,base['conversation_key'])).fetchall()
  if len(records)>1000:raise ValueError('Source limit')
  output=[]
  for payload,hashed in records:
   if hashlib.sha256(payload.encode()).hexdigest()!=hashed:raise ValueError('Original mismatch')
   m=valid_mail(json.loads(payload),date(window[0]),date(window[1]))
   ident=str(uuid.uuid5(uuid.UUID(owner),'local-mail:'+m['source_key']))
   row=dict(id=ident,direction=m['direction'],subject=re.sub(r'[^\s<>@]+@[a-zA-Z0-9.-]+','[메일 주소 생략]',m['subject']),occurred_at=m['occurred_at'],inquiry_id=iid,state='linked',excluded=False,body_length=len(m['body']),local_original=True)
   if mail_id==ident:
    held=len(m['body'])>100000 or bool(SENSITIVE.search(m['body']))
    row.update(original_held=held,original=dict(subject=row['subject'],body='민감 정보 가능성·긴 본문으로 화면 표시 보류. 전체 원문은 Outlook에서 확인하세요.' if held else m['body'],attachments=m['attachments']))
    return {'mail':row}
   output.append(row)
  if mail_id:raise ValueError('Source unavailable')
  return {'mails':output[:12],'hasMore':len(output)>12}
def communication_event(mail,settings,sender_domains,recipient_domains,owner,iid):
 top=newest_text(mail['body'])
 if len(mail['body'])>100000 or not top.strip() or SENSITIVE.search(top):return None
 if mail['direction']=='received':
  domains=[domain_of(mail['sender']) or sender_domains.get(mail['source_key']) or settings.get('resolved_domains',{}).get(mail['source_key'])]
 else:domains=recipient_domains.get(mail['source_key'],[])
 if not domains or any(not d for d in domains):return None
 matches=[]
 for domain in domains:
  customer=next((c for c in settings.get('customers',[]) if domain in c.get('domains',[])),None)
  if domain in settings.get('hq_domains',[]):matches.append(('hq','HQ'))
  elif customer:matches.append(('customer',customer['name']))
  else:return None
 if len(set(matches))!=1:return None
 party,target=matches[0];sent=mail['direction']=='sent'
 message=dict(id=str(uuid.uuid5(uuid.UUID(owner),'history:'+iid+':'+mail['source_key'])),kind=party+('_sent' if sent else '_received'),target=target,
   subject=re.sub(r'[^\s<>@]+@[a-zA-Z0-9.-]+','[메일 주소 생략]',mail['subject'])[:300],body=top[:1200],occurred_at=mail['occurred_at'],summary='Outlook 수신·발신 사실 자동 기록. 본문 발췌이며 전체 원문은 이 PC에 보존.')
 if sent:message['actual_confirmed']=True
 return dict(inquiry_id=iid,source_key=mail['source_key'],message=message)

def candidate(mail,settings):
 if mail['direction']!='received' or len(mail['body'])>100000 or not mail.get('conversation_key'):return None
 subject=re.sub(r'^(?:(?:re|fw|fwd|回覆|回复|답장)\s*[:：]\s*)+','',mail['subject'].strip(),flags=re.I)
 if re.search(r'^(?:Agile|DWT)|expense report status change|VPN Release Announcement|newsletter|뉴스레터|(?:notification|alert|알림)$',subject,re.I):return None
 top=newest_text(mail['body'])
 if SENSITIVE.search(top):return None
 row=review(mail,settings)
 if row['category'] not in {'고객 업무','고객 업무 후보','HQ 업무','HQ 업무 후보'}:return None
 # A customer title tag or quoted Candy signature is not sales ownership.
 direct=bool(re.search(r'\bcandy\b',mail['recipients'],re.I))
 korea=settings.get('sender_regions',{}).get(row['sender_domain'])=='Korea'
 if not (direct or korea):return None
 if not re.search(r'please|request|could you|would you|can you|요청|문의|부탁|請|请|麻煩|麻烦|詢問|询问|需求|協助|协助',top,re.I):return None
 customer=next((c for c in settings.get('customers',[]) if row['sender_domain'] in c.get('domains',[])),None)
 hq=row['sender_domain'] in settings.get('hq_domains',[])
 if not customer and not hq:return None
 category='HQ 업무' if hq else '고객 업무'
 return dict(source_key=mail['source_key'],category=category,subject=row['subject'],customer=customer['name'] if customer else 'Source Photonics HQ',
             customer_id=customer.get('id') if customer else None,occurred_at=mail['occurred_at'],excerpt=top[:1200],
             next_action='요청 조건을 확인하고 '+('HQ 업무에 답변' if hq else '고객에게 답변'),
             evidence=['확인된 '+('HQ' if hq else '고객')+' 도메인','직접 수신 대상 Candy' if direct else '별도 확인된 발신 지역 Korea','최신 본문에 요청'],
             automatic_registration=bool(customer and customer.get('id')),needs_customer_choice=not bool(customer and customer.get('id')))

def discover(paths,owner,scope,settings,linked,reviewed,since=None):
 uuid.UUID(owner);digest(scope);records={};imports={};last=None;domains={};choices={}
 for path in dict.fromkeys(Path(p) for p in paths):
  if not path.exists():continue
  with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)) as c:
   c.execute('BEGIN')
   if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
   window=c.execute('SELECT window_start,window_end,last_capture_at FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
   if not window:continue
   last=max(filter(None,[last,window[2]]),default=None)
   rows=c.execute('SELECT payload,payload_hash FROM mail_outbox WHERE scope_key=? LIMIT 5001',(scope,)).fetchall()
   if len(rows)>5000:raise ValueError('Discovery bounds exceeded')
   for payload,hashed in rows:
    if hashlib.sha256(payload.encode()).hexdigest()!=hashed:raise ValueError('Original mismatch')
    mail=valid_mail(json.loads(payload),date(window[0]),date(window[1]));key=mail['source_key']
    if key in records and canonical(records[key])!=payload:raise ValueError('Original conflict')
    records[key]=mail
   if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discovery_imports'").fetchone():
    imports.update(c.execute('SELECT source_key,inquiry_id FROM discovery_imports'))
   if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sender_domains'").fetchone():
    domains.update(c.execute('SELECT source_key,domain FROM sender_domains WHERE scope_key=?',(scope,)))
   if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discovery_choices'").fetchone():choices.update(c.execute('SELECT source_key,customer_id FROM discovery_choices'))
 settings=settings|dict(resolved_domains=settings.get('resolved_domains',{})|domains)
 groups={};candidates=[];threads=[]
 for mail in sorted(records.values(),key=lambda m:date(m['occurred_at'])):
  if since and date(mail['occurred_at'])<date(since):continue
  if mail['source_key'] in reviewed or mail['conversation_key'] in linked:continue
  value=candidate(mail,settings)
  if not value:continue
  if mail['source_key'] in choices:value.update(customer_id=choices[mail['source_key']],automatic_registration=True,needs_customer_choice=False)
  # Keep distinct no-ID messages separate, and never merge by title.
  key=mail['conversation_key'] or mail['source_key']
  if key in groups:continue
  groups[key]=True;value['inquiry_id']=imports.get(mail['source_key']);candidates.append(value)
  if value['inquiry_id']:
   ordered=sorted([m for m in records.values() if (m['conversation_key'] or m['source_key'])==key],key=lambda m:date(m['occurred_at']))
   timeline=[]
   for m in ordered[-12:]:
    top=newest_text(m['body']);held=len(m['body'])>100000 or bool(SENSITIVE.search(top))
    timeline.append(dict(source_key=m['source_key'],direction=m['direction'],occurred_at=m['occurred_at'],excerpt='' if held else top[:1200],held=held))
   local_id=str(uuid.uuid5(uuid.UUID(owner),'local-mail:'+mail['source_key']))
   source=dict(id=local_id,subject=value['subject'],direction='received',occurred_at=mail['occurred_at'],inquiry_id=value['inquiry_id'],state='linked',excluded=False,body_length=len(mail['body']),local_original=True,category_group=value['category'],classification_state='proposed',proposal=dict(role='HQ' if value['category']=='HQ 업무' else '고객사',category=value['category'],confidence='로컬 담당 규칙',evidence=value['evidence']))
   threads.append(dict(mail_id=local_id,inquiry_id=value['inquiry_id'],local_mail=source,timeline=timeline,received=sum(m['direction']=='received' for m in ordered),sent=sum(m['direction']=='sent' for m in ordered),proposal=propose(ordered[-1],ordered,value['category'])))
 if len(candidates)>100:raise ValueError('Candidate limit exceeded')
 return dict(candidates=candidates,imported_threads=threads,discovery_checked_at=last,local_only=True,external_ai_calls=0)

def collect_new(path,owner,scope,start,end,capture):
 uuid.UUID(owner);digest(scope);start=date(start);end=date(end)
 if Path(path).exists():
  with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as c:
   if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
   state=c.execute('SELECT window_end FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
   if state:start=max(start,date(state[0])-timedelta(minutes=5))
 if start>=end:return dict(skipped='no_elapsed_window')
 batch=capture(scope,start.isoformat(),end.isoformat(),set());batch.pop('conversation_links',None)
 if batch['scope_key']!=scope or date(batch['start'])!=start or date(batch['end'])!=end:raise ValueError('Capture bounds changed')
 # Validation before creating a cache avoids a misleading successful checkpoint.
 for m in batch['records']:valid_mail(m,start,end)
 box=Outbox(path)
 try:box.bind_owner(owner);return stage_batch(box,batch)
 finally:box.close()

def stage_batch(box,batch):
 batch=batch.copy();domains=batch.pop('sender_domains',{});recipients=batch.pop('recipient_domains',{})
 sources={m['source_key'] for m in batch['records']}
 if not isinstance(domains,dict) or len(domains)>5000:raise ValueError('Invalid sender domains')
 for key,value in domains.items():
  digest(key)
  if key not in sources or not isinstance(value,str) or not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}',value):raise ValueError('Invalid domain identity')
 if not isinstance(recipients,dict) or len(recipients)>5000:raise ValueError('Invalid recipients')
 for key,values in recipients.items():
  digest(key)
  if key not in sources or not isinstance(values,list) or len(values)>100 or len(set(values))!=len(values) or any(not isinstance(d,str) or not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}',d) for d in values):raise ValueError('Invalid recipient domains')
 for table,column,values in [('sender_domains','domain',domains),('recipient_domains','domains',{k:canonical(sorted(v)) for k,v in recipients.items()})]:
  if box.connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
   for key,value in values.items():
    old=box.connection.execute('SELECT '+column+' FROM '+table+' WHERE scope_key=? AND source_key=?',(batch['scope_key'],key)).fetchone()
    if old and old[0]!=value:raise ValueError('Participant metadata changed')
 result=box.stage(batch)
 with box.connection:
  box.connection.execute('CREATE TABLE IF NOT EXISTS sender_domains(scope_key TEXT NOT NULL,source_key TEXT NOT NULL,domain TEXT NOT NULL,PRIMARY KEY(scope_key,source_key))')
  for key,value in domains.items():
   old=box.connection.execute('SELECT domain FROM sender_domains WHERE scope_key=? AND source_key=?',(batch['scope_key'],key)).fetchone()
   if old and old[0]!=value:raise ValueError('Sender domain changed')
   box.connection.execute('INSERT OR IGNORE INTO sender_domains VALUES(?,?,?)',(batch['scope_key'],key,value))
  box.connection.execute('CREATE TABLE IF NOT EXISTS recipient_domains(scope_key TEXT NOT NULL,source_key TEXT NOT NULL,domains TEXT NOT NULL,PRIMARY KEY(scope_key,source_key))')
  for key,values in recipients.items():
   encoded=canonical(sorted(values));old=box.connection.execute('SELECT domains FROM recipient_domains WHERE scope_key=? AND source_key=?',(batch['scope_key'],key)).fetchone()
   if old and old[0]!=encoded:raise ValueError('Recipient domains changed')
   box.connection.execute('INSERT OR IGNORE INTO recipient_domains VALUES(?,?,?)',(batch['scope_key'],key,encoded))
 return result

def for_targets(original,followups,owner,targets):
 from outlook_followups import seeds,linked_keys
 selected=seeds(original,owner,targets);scope=selected[0][0]['scope_key']
 linked=set().union(*(linked_keys(followups,owner,t['id'],m['conversation_key']) for t,m,_ in selected))
 settings=load_settings()
 return discover([DESTINATION],owner,scope,settings,linked,set(),min(w[1] for _,_,w in selected))

def prepare_import(path,owner,value,today):
 namespace=uuid.UUID(owner);key=digest(value['source_key']);uuid.UUID(value['customer_id'])
 if not value['automatic_registration'] or value['category'] not in {'고객 업무','HQ 업무'}:raise ValueError('Customer selection required')
 with closing(sqlite3.connect(path)) as c:
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  c.execute('CREATE TABLE IF NOT EXISTS discovery_plans(source_key TEXT PRIMARY KEY,plan TEXT NOT NULL)')
  saved=c.execute('SELECT plan FROM discovery_plans WHERE source_key=?',(key,)).fetchone()
  if saved:return json.loads(saved[0])
  iid=str(uuid.uuid5(namespace,'inquiry:'+key));aid=str(uuid.uuid5(namespace,'action:'+key));mid=str(uuid.uuid5(namespace,'received:'+key))
  due=(date(today+'T00:00:00+09:00')+timedelta(days=3)).date().isoformat()
  plan=dict(registration=dict(id=iid,customer_id=value['customer_id'],title=value['subject'][:300],channel='Outlook',received_at=value['occurred_at'],
          original_text='메일 요청 요약 / 전체 원문은 이 PC에 보존\n'+value['excerpt'],next_action=value['next_action']),
          action=dict(id=aid,kind='customer_reply' if value['category']=='고객 업무' else 'other',description=value['next_action']+' — '+value['subject'][:300],due_date=due,mandatory=True),
          message=dict(id=mid,kind='customer_received' if value['category']=='고객 업무' else 'hq_received',target=value['customer'],subject=value['subject'][:300],body=value['excerpt'],occurred_at=value['occurred_at'],summary='수신 요청을 로컬 규칙으로 정리. 전체 원문은 이 PC에 보존.'),source_key=key)
  c.execute('INSERT OR IGNORE INTO discovery_plans VALUES(?,?)',(key,canonical(plan)));c.commit()
  return json.loads(c.execute('SELECT plan FROM discovery_plans WHERE source_key=?',(key,)).fetchone()[0])

def ack_import(path,owner,key,iid):
 uuid.UUID(owner);digest(key);uuid.UUID(iid)
 with closing(sqlite3.connect(path)) as c:
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  plan=c.execute('SELECT plan FROM discovery_plans WHERE source_key=?',(key,)).fetchone()
  if not plan or json.loads(plan[0])['registration']['id']!=iid:raise ValueError('Import mismatch')
  c.execute('CREATE TABLE IF NOT EXISTS discovery_imports(source_key TEXT PRIMARY KEY,inquiry_id TEXT NOT NULL)')
  c.execute('INSERT OR IGNORE INTO discovery_imports VALUES(?,?)',(key,iid));c.commit()

def choose_customer(path,owner,value,customer_id):
 uuid.UUID(owner);uuid.UUID(customer_id);digest(value['source_key'])
 if value.get('inquiry_id') or value.get('automatic_registration'):raise ValueError('Selection already settled')
 with closing(sqlite3.connect(path)) as c:
  if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
  c.execute('CREATE TABLE IF NOT EXISTS discovery_choices(source_key TEXT PRIMARY KEY,customer_id TEXT NOT NULL)')
  c.execute('INSERT INTO discovery_choices VALUES(?,?)',(value['source_key'],customer_id));c.commit()

def read_events(original,followups,owner,targets,cutoffs):
 from outlook_followups import seeds,linked_keys
 selected=seeds(original,owner,targets);scope=selected[0][0]['scope_key'];records={};senders={};recipients={};imports={}
 if set(cutoffs)-{t['id'] for t,_,_ in selected}:raise ValueError('Unexpected review cutoff')
 for path in [original,followups,DESTINATION]:
  if not Path(path).exists():continue
  with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as c:
   c.execute('BEGIN')
   if c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()!=(owner,):raise ValueError('Owner mismatch')
   window=c.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
   if not window:continue
   rows=c.execute('SELECT payload,payload_hash FROM mail_outbox WHERE scope_key=? LIMIT 5001',(scope,)).fetchall()
   if len(rows)>5000:raise ValueError('History limit')
   for payload,hashed in rows:
    if hashlib.sha256(payload.encode()).hexdigest()!=hashed:raise ValueError('Original mismatch')
    m=valid_mail(json.loads(payload),date(window[0]),date(window[1]));key=m['source_key']
    if key in records and canonical(records[key])!=payload:raise ValueError('Original conflict')
    records[key]=m
   for table,target in [('sender_domains',senders),('recipient_domains',recipients)]:
    if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
     values=c.execute('SELECT source_key,'+('domain' if table=='sender_domains' else 'domains')+' FROM '+table+' WHERE scope_key=?',(scope,)).fetchall()
     target.update(values if table=='sender_domains' else ((k,json.loads(v)) for k,v in values))
   if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discovery_imports'").fetchone():imports.update(c.execute('SELECT source_key,inquiry_id FROM discovery_imports'))
 settings=load_settings();scopes=[]
 for t,base,window in selected:
  keys=linked_keys(followups,owner,t['id'],base['conversation_key']);cutoff=date(cutoffs.get(t['id'],window[1]))
  scopes.append((t['inquiry_id'],keys,cutoff,base['source_key']))
 for key,iid in imports.items():
  base=records.get(key)
  if not base:raise ValueError('Imported original missing')
  uuid.UUID(iid);scopes.append((iid,{base['conversation_key']} if base['conversation_key'] else set(),date(base['occurred_at']),key))
 events=[];held=0
 for m in sorted(records.values(),key=lambda m:(date(m['occurred_at']),m['source_key'])):
  matches={iid for iid,keys,cutoff,key in scopes if m['conversation_key'] in keys and date(m['occurred_at'])>=cutoff and m['source_key']!=key}
  if not matches:continue
  if len(matches)!=1:held+=1;continue
  event=communication_event(m,settings,senders,recipients,owner,next(iter(matches)))
  if event:events.append(event)
  else:held+=1
 if len(events)>100:raise ValueError('Event reconciliation limit')
 return dict(events=events,held=held)

if __name__=='__main__':
 import sys
 try:
  from outlook_followups import ORIGINAL,DESTINATION as FOLLOWUPS
  config=json.loads(sys.stdin.read(40000))
  if config.get('mode')=='sources':
   if set(config)!={'mode','owner','targets','inquiry_id','mail_id'}:raise ValueError('Invalid input')
   from outlook_followups import seeds
   seeds(ORIGINAL,config['owner'],config['targets'])
   print(json.dumps(local_sources(DESTINATION,config['owner'],config['inquiry_id'],config['mail_id']),ensure_ascii=False));sys.exit(0)
  if config.get('mode')=='events':
   if set(config)!={'mode','owner','targets','cutoffs'}:raise ValueError('Invalid input')
   print(json.dumps(read_events(ORIGINAL,FOLLOWUPS,config['owner'],config['targets'],config['cutoffs']),ensure_ascii=False));sys.exit(0)
  if config.get('mode')=='choose':
   if set(config)!={'mode','owner','targets','source_key','customer_id'}:raise ValueError('Invalid input')
   rows=for_targets(ORIGINAL,FOLLOWUPS,config['owner'],config['targets'])['candidates']
   value=next(v for v in rows if v['source_key']==digest(config['source_key']))
   choose_customer(DESTINATION,config['owner'],value,config['customer_id']);print(json.dumps({'chosen':True}));sys.exit(0)
  if set(config)!={'mode','owner','targets','source_key'} or config['mode'] not in {'prepare','ack'}:raise ValueError('Invalid input')
  rows=for_targets(ORIGINAL,FOLLOWUPS,config['owner'],config['targets'])['candidates']
  value=next(v for v in rows if v['source_key']==digest(config['source_key']))
  today=datetime.now(timezone(timedelta(hours=9))).date().isoformat()
  plan=prepare_import(DESTINATION,config['owner'],value,today)
  if config['mode']=='ack':ack_import(DESTINATION,config['owner'],config['source_key'],plan['registration']['id'])
  print(json.dumps(plan if config['mode']=='prepare' else {'saved':True},ensure_ascii=False))
 except Exception:sys.exit(1)

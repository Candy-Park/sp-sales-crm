"""Local durable mail outbox. No credentials, Outlook writes, or network on import.

Delivery is injected by the authenticated transport. A receipt, not a send attempt,
removes a pending mail. Capture is all-or-nothing and never overwrites an original.
"""
import hashlib
import json
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone

RETRYABLE_STATUS=frozenset({408,429,500,502,503,504,520})
HEX=re.compile(r'^[0-9a-f]{64}$')
MAIL_FIELDS={'source_key','identity_method','direction','subject','body','sender','recipients','occurred_at','conversation_key','attachments'}

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def date(value):
    if not isinstance(value,str):raise ValueError('Invalid capture time')
    try:result=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:raise ValueError('Invalid capture time') from None
    if result.tzinfo is None:raise ValueError('Timezone required')
    return result

def digest(value):
    if not isinstance(value,str) or not HEX.fullmatch(value):raise ValueError('Hashed source identity required')
    return value

def valid_mail(value,start,end):
    if not isinstance(value,dict) or set(value)!=MAIL_FIELDS:raise ValueError('Unexpected or missing mail fields')
    digest(value['source_key'])
    if value['identity_method'] not in {'internet_message_id','entry_id_fallback'}:raise ValueError('Invalid identity method')
    if value['direction'] not in {'received','sent'}:raise ValueError('Invalid direction')
    for key,maximum in [('subject',1000),('body',10000000),('sender',2000),('recipients',10000)]:
        if not isinstance(value[key],str) or len(value[key])>maximum:raise ValueError('Invalid mail text size')
    if not start<=date(value['occurred_at'])<end:raise ValueError('Mail is outside capture window')
    if value['conversation_key'] is not None:digest(value['conversation_key'])
    attachments=value['attachments']
    if not isinstance(attachments,list) or len(attachments)>100:raise ValueError('Invalid attachment metadata')
    for entry in attachments:
        if not isinstance(entry,dict) or set(entry)!={'name','size'}:raise ValueError('Attachment content is not accepted')
        if not isinstance(entry['name'],str) or len(entry['name'])>1000 or not entry['name'].strip():raise ValueError('Invalid attachment name')
        if type(entry['size']) is not int or not 0<=entry['size']<=2**53-1:raise ValueError('Invalid attachment size')
    return json.loads(canonical(value))

class DeliveryError(Exception):
    def __init__(self,status):
        self.status=status
        super().__init__('Delivery failed')

class Outbox:
    def __init__(self,path):
        self.connection=sqlite3.connect(path,timeout=10)
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.executescript("""
        CREATE TABLE IF NOT EXISTS mail_outbox(
          scope_key TEXT NOT NULL, source_key TEXT NOT NULL, id TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt TEXT,
          PRIMARY KEY(scope_key,source_key));
        CREATE TABLE IF NOT EXISTS capture_state(
          scope_key TEXT PRIMARY KEY,last_capture_at TEXT,last_success_at TEXT,last_error TEXT,
          window_start TEXT,window_end TEXT);
        CREATE TABLE IF NOT EXISTS agent_binding(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        """)
    def close(self):
        self.connection.close()
    def bind_owner(self,owner):
        try:owner=str(uuid.UUID(owner))
        except (ValueError,TypeError,AttributeError):raise ValueError('Invalid owner identity') from None
        with self.connection:
            old=self.connection.execute('SELECT value FROM agent_binding WHERE key=?',('owner',)).fetchone()
            if old and old[0]!=owner:raise ValueError('Outbox belongs to another account')
            self.connection.execute('INSERT OR IGNORE INTO agent_binding VALUES(?,?)',('owner',owner))
    def stage(self,batch):
        if not isinstance(batch,dict) or set(batch)!={'version','batch_id','scope_key','start','end','records'} or type(batch['version']) is not int or batch['version']!=1:raise ValueError('Invalid capture batch')
        try:uuid.UUID(batch['batch_id'])
        except (ValueError,TypeError,AttributeError):raise ValueError('Invalid batch identity') from None
        scope=digest(batch['scope_key']); start=date(batch['start']); end=date(batch['end'])
        if start>=end or start.second or start.microsecond or end.second or end.microsecond:raise ValueError('Whole-minute capture window required')
        if not isinstance(batch['records'],list) or len(batch['records'])>5000:raise ValueError('Invalid capture size')
        inserted=duplicates=0
        with self.connection:
            previous=self.connection.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
            kept_start=batch['start'];kept_end=batch['end']
            if previous:
                if date(previous[0])<start:kept_start=previous[0]
                if date(previous[1])>end:kept_end=previous[1]
            for record in batch['records']:
                value=valid_mail(record,start,end); payload=canonical(value)
                hashed=hashlib.sha256(payload.encode('utf-8')).hexdigest()
                old=self.connection.execute('SELECT payload_hash FROM mail_outbox WHERE scope_key=? AND source_key=?',(scope,value['source_key'])).fetchone()
                if old:
                    if old[0]!=hashed:raise ValueError('Same mail identity has conflicting original content')
                    duplicates+=1
                else:
                    self.connection.execute('INSERT INTO mail_outbox VALUES(?,?,?,?,?,NULL)',(scope,value['source_key'],str(uuid.uuid4()),payload,hashed)); inserted+=1
            self.connection.execute("""INSERT INTO capture_state(scope_key,last_capture_at,window_start,window_end)
              VALUES(?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET last_capture_at=excluded.last_capture_at,
              window_start=excluded.window_start,window_end=excluded.window_end""",(scope,self.now(),kept_start,kept_end))
        return {'inserted':inserted,'duplicates':duplicates}
    def pending(self,scope,limit=100):
        digest(scope)
        if type(limit) is not int or not 1<=limit<=5000:raise ValueError('Invalid delivery limit')
        rows=self.connection.execute('SELECT id,payload,payload_hash FROM mail_outbox WHERE scope_key=? AND receipt IS NULL ORDER BY rowid LIMIT ?',(scope,limit)).fetchall()
        return [dict(json.loads(payload),id=ident,scope_key=scope,payload_hash=hashed) for ident,payload,hashed in rows]
    def acknowledge(self,scope,key,receipt):
        digest(scope); digest(key)
        if not isinstance(receipt,dict) or set(receipt)!={'id','source_key','payload_hash'}:raise ValueError('Invalid server receipt')
        try:uuid.UUID(receipt['id'])
        except (ValueError,TypeError,AttributeError):raise ValueError('Invalid server receipt') from None
        with self.connection:
            old=self.connection.execute('SELECT payload_hash,receipt FROM mail_outbox WHERE scope_key=? AND source_key=?',(scope,key)).fetchone()
            if not old or receipt['source_key']!=key or receipt['payload_hash']!=old[0]:raise ValueError('Server receipt does not match original mail')
            encoded=canonical(receipt)
            if old[1] is not None and old[1]!=encoded:raise ValueError('Conflicting server receipt')
            self.connection.execute('UPDATE mail_outbox SET receipt=? WHERE scope_key=? AND source_key=?',(encoded,scope,key))
    @staticmethod
    def now():return datetime.now(timezone.utc).isoformat()
    def status(self,scope):
        digest(scope)
        row=self.connection.execute('SELECT last_capture_at,last_success_at,last_error,window_start,window_end FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
        state=dict(zip(['last_capture_at','last_success_at','last_error','window_start','window_end'],row or [None]*5))
        state['pending']=self.connection.execute('SELECT count(*) FROM mail_outbox WHERE scope_key=? AND receipt IS NULL',(scope,)).fetchone()[0]
        return state
    def flush(self,scope,send,limit=100,wait=time.sleep):
        delivered=0; error=None
        for record in self.pending(scope,limit):
            for attempt in range(3):
                try:
                    receipt=send(record)
                    self.acknowledge(scope,record['source_key'],receipt)
                    delivered+=1; break
                except DeliveryError as failure:
                    error=f'http_{failure.status}'
                    if failure.status not in RETRYABLE_STATUS or attempt==2:break
                    wait(attempt+1); continue
                except (TimeoutError,OSError):
                    error='network_error'
                    if attempt==2:break
                    wait(attempt+1); continue
                except ValueError:
                    error='invalid_receipt'; break
            else:continue
            # Successful acknowledgement clears the last attempt error.
            if self.connection.execute('SELECT receipt FROM mail_outbox WHERE scope_key=? AND source_key=?',(scope,record['source_key'])).fetchone()[0] is not None:error=None
            if error:break
        with self.connection:
            self.connection.execute('UPDATE capture_state SET last_error=? WHERE scope_key=?',(error,scope))
            if not error and self.status(scope)['pending']==0:
                self.connection.execute('UPDATE capture_state SET last_success_at=? WHERE scope_key=?',(self.now(),scope))
        return dict(delivered=delivered,error=error,pending=self.status(scope)['pending'])

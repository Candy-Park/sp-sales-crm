"""Explicit CRM-started collection. Credentials only arrive via stdin, never saved/logged."""
import json
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from outlook_outbox import Outbox,canonical,DeliveryError

ROOT=Path('D:/AI/projects/sp-sales-crm/sources/outlook').resolve()
PROJECT='https://glscckjmlwvxilzneqdf.supabase.co'

def envelope(record):
    mail={k:v for k,v in record.items() if k not in {'id','scope_key','payload_hash'}}
    length=len(mail['body'])
    if length>100000:mail['body']=None
    return {k:record[k] for k in ['id','scope_key','source_key','payload_hash']}|{'body_length':length,'original_json':canonical(mail)}

def location():
    info=json.loads((Path(__file__).resolve().parent.parent/'notes/outlook-capture-location.json').read_text(encoding='utf-8-sig'))
    path=Path(info['capture_path']).resolve()
    if not path.is_relative_to(ROOT) or path.suffix!='.json':raise ValueError('Capture location invalid')
    return path

def run(config):
    batch=json.loads(location().read_text(encoding='utf-8-sig'))
    box=Outbox(ROOT/'outbox.sqlite')
    try:
        box.bind_owner(config['owner'])
        if config.get('mode')=='collect':
            destination=ROOT/('capture-crm-'+str(uuid.uuid4())+'.json')
            # Only hashes, approved window, and non-secret file paths in process arguments.
            result=subprocess.run(['powershell.exe','-NoProfile','-File',str(Path(__file__).with_name('outlook_collect_scope.ps1')),
                '-ScopeKey',batch['scope_key'],'-Start',batch['start'][:19],'-End',batch['end'][:19],'-OutputPath',str(destination)],
                capture_output=True,timeout=180)
            if result.returncode:raise ValueError('Outlook capture failed')
            batch=json.loads(destination.read_text(encoding='utf-8-sig'))
            staged=box.stage(batch)
            def send(record):
                request=Request(PROJECT+'/rest/v1/rpc/sales_ingest_outlook',data=json.dumps({'p_data':envelope(record)},ensure_ascii=False).encode(),
                    headers={'apikey':config['key'],'Authorization':config['authorization'],'Content-Type':'application/json'})
                try:
                    with urlopen(request,timeout=15) as response:return json.load(response)
                except HTTPError as e:raise DeliveryError(e.code) from None
                except URLError:raise OSError('Network unavailable') from None
            delivered=box.flush(batch['scope_key'],send,limit=5000)
        else:staged=delivered=None
        state=box.status(batch['scope_key'])
        counts=box.connection.execute("SELECT count(*),sum(CASE WHEN json_extract(payload,'$.body') IS NOT NULL AND length(json_extract(payload,'$.body'))>100000 THEN 1 ELSE 0 END),sum(CASE WHEN receipt IS NOT NULL THEN 1 ELSE 0 END) FROM mail_outbox WHERE scope_key=?",(batch['scope_key'],)).fetchone()
        return dict(state,total=counts[0],held=counts[1] or 0,receipted=counts[2] or 0,staged=staged,delivery=delivered)
    finally:box.close()

if __name__=='__main__':
    try:
        config=json.load(sys.stdin)
        result=run(config)
    except Exception:
        result={'error':'local_collection_failed'}
    print(json.dumps(result))

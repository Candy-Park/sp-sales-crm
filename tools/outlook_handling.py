"""Read-only user-reviewed handling; no tokens, bodies or mailbox writes in output."""
import hashlib,json,sqlite3,sys,uuid
from pathlib import Path
from contextlib import closing

def read_handling(database,worksheet,owner):
    uuid.UUID(owner)
    report=json.loads(Path(worksheet).read_text(encoding='utf-8'))
    cases=report['cases']
    if not 1<=len(cases)<=1000 or report.get('version')!=2:raise ValueError('Review unavailable')
    with closing(sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True)) as c:
        c.execute('BEGIN')
        bound=c.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()
        if not bound or bound[0]!=owner:raise ValueError('Owner mismatch')
        result=[];seen=set()
        for case in cases:
            if case['user_review_status']!='user_confirmed_crm_handling' or case['source_key'] in seen:raise ValueError('Review mismatch')
            seen.add(case['source_key'])
            row=c.execute('SELECT scope_key,payload,payload_hash,receipt FROM mail_outbox WHERE source_key=?',(case['source_key'],)).fetchall()
            if len(row)!=1:raise ValueError('Original missing')
            scope,payload,hashed,receipt=row[0]
            if hashlib.sha256(payload.encode()).hexdigest()!=hashed:raise ValueError('Original mismatch')
            mail=json.loads(payload)
            if mail['direction']!='received' or mail['source_key']!=case['source_key'] or hashlib.sha256(json.dumps(mail,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=case['payload_sha256']:raise ValueError('Review original mismatch')
            saved=json.loads(receipt) if receipt else None
            if not saved or saved['source_key']!=case['source_key'] or saved['payload_hash']!=hashed:raise ValueError('Receipt mismatch')
            uuid.UUID(saved['id'])
            reply=case.get('confirmed_reply_pattern')
            note='주된 회신 담당: '+reply['usually_replied_by']+' · 영업 담당은 유지' if reply else ''
            result.append(dict(id=saved['id'],scope_key=scope,source_key=saved['source_key'],payload_hash=hashed,case_id=case['case_id'],include=case['crm_registration_candidate'],category=case['expected_category'],role=case['expected_role'],reason=case['confirmed_handling_reason'],reply_note=note))
        return result

if __name__=='__main__':
    try:
        config=json.loads(sys.stdin.read(1000))
        if set(config)!={'owner'}:raise ValueError('Unexpected input')
        rows=read_handling('D:/AI/projects/sp-sales-crm/sources/outlook/outbox.sqlite','D:/AI/projects/sp-sales-crm/outputs/2026-10-09-mail-review-20-user-review-v2.json',config['owner'])
        print(json.dumps(rows,ensure_ascii=False))
    except Exception:sys.exit(1)

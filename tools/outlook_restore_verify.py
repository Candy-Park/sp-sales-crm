"""Verify a local outbox backup in isolation; never upload or replace the live DB.

Run as python -m tools.outlook_restore_verify. Reports contain counts/hashes only.
Private backup/restore files belong in sources/backups and scratch, not outputs/Git.
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from tools.outlook_outbox import Outbox, canonical, digest, valid_mail, date


def read_only(path):
    return sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)


def inspect(connection):
    if connection.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
        raise ValueError('SQLite integrity check failed')
    hashes={key:hashlib.sha256() for key in ['originals','receipts','state','binding']}
    counts=dict(total=0,receipted=0,pending=0,held=0,received=0,sent=0)
    states={r[0]:r for r in connection.execute('SELECT * FROM capture_state ORDER BY scope_key')}
    for row in states.values():hashes['state'].update(canonical(row).encode('utf-8'))
    bindings=list(connection.execute('SELECT key,value FROM agent_binding ORDER BY key'))
    for row in bindings:hashes['binding'].update(canonical(row).encode('utf-8'))
    for scope,key,ident,payload,hashed,receipt in connection.execute('SELECT scope_key,source_key,id,payload,payload_hash,receipt FROM mail_outbox ORDER BY scope_key,source_key'):
        digest(scope);digest(key);digest(hashed);uuid.UUID(ident)
        if hashlib.sha256(payload.encode('utf-8')).hexdigest()!=hashed:
            raise ValueError('Original hash mismatch')
        if scope not in states:raise ValueError('Capture state missing')
        value=valid_mail(json.loads(payload),date(states[scope][4]),date(states[scope][5]))
        if value['source_key']!=key:raise ValueError('Original identity mismatch')
        if receipt is not None:
            r=json.loads(receipt)
            if set(r)!={'id','source_key','payload_hash'} or r['source_key']!=key or r['payload_hash']!=hashed:
                raise ValueError('Receipt does not match original')
            uuid.UUID(r['id'])
        hashes['originals'].update(canonical([scope,key,ident,payload,hashed]).encode('utf-8'))
        hashes['receipts'].update(canonical([scope,key,receipt]).encode('utf-8'))
        counts['total']+=1;counts['receipted']+=receipt is not None;counts['pending']+=receipt is None
        counts['held']+=len(value['body'])>100000;counts[value['direction']]+=1
    return dict(counts=counts,digests={k:v.hexdigest() for k,v in hashes.items()},owner_bound=any(k=='owner' for k,_ in bindings))


def reserve(path):
    path=Path(path).resolve();path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb'):pass
    return path


def verify(source,backup,restore):
    source,backup,restore=[Path(p).resolve() for p in [source,backup,restore]]
    if len({source,backup,restore})!=3 or backup.exists() or restore.exists():
        raise ValueError('Distinct new backup and restore paths required')
    with closing(read_only(source)) as live:
        live.execute('BEGIN');before=inspect(live)
        reserve(backup)
        with closing(sqlite3.connect(backup)) as saved:live.backup(saved)
    reserve(restore);shutil.copyfile(backup,restore)
    with closing(read_only(backup)) as saved:
        if inspect(saved)!=before:raise ValueError('Backup differs from snapshot')
    with closing(read_only(restore)) as restored:
        if inspect(restored)!=before:raise ValueError('Restore differs from snapshot')
    box=Outbox(restore)
    try:
        owner=box.connection.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()
        owner_rejected=None
        if owner:
            box.bind_owner(owner[0])
            try:box.bind_owner(str(uuid.uuid4()))
            except ValueError:owner_rejected=True
            else:raise ValueError('Restored queue accepted another owner')
        if inspect(box.connection)!=before:raise ValueError('Reopening changed restored data')
        inserted=duplicates=0
        for scope,start,end in list(box.connection.execute('SELECT scope_key,window_start,window_end FROM capture_state')):
            if box.status(scope)['pending']!=box.connection.execute('SELECT count(*) FROM mail_outbox WHERE scope_key=? AND receipt IS NULL',(scope,)).fetchone()[0]:
                raise ValueError('Restored pending count mismatch')
            records=[json.loads(r[0]) for r in box.connection.execute('SELECT payload FROM mail_outbox WHERE scope_key=?',(scope,))]
            result=box.stage(dict(version=1,batch_id=str(uuid.uuid4()),scope_key=scope,start=start,end=end,records=records))
            inserted+=result['inserted'];duplicates+=result['duplicates']
        replay=inspect(box.connection)
        if inserted or duplicates!=before['counts']['total'] or any(replay['digests'][k]!=before['digests'][k] for k in ['originals','receipts','binding']):
            raise ValueError('Replay changed originals or receipts')
    finally:box.close()
    with closing(read_only(restore)) as reopened:
        if inspect(reopened)!=replay:raise ValueError('Restart lost restored data')
    with closing(read_only(source)) as live:unchanged=inspect(live)==before
    return dict(result='local_outbox_restore_passed',**before,source_unchanged=unchanged,backup_restore_equal=True,restart_preserved=True,
                replay_inserted=inserted,replay_duplicates=duplicates,other_owner_rejected=owner_rejected,network_calls=0,
                scope='local_outlook_outbox_only')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['source','backup','restore','report']:parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    report=Path(args.report).resolve()
    if report in [Path(p).resolve() for p in [args.source,args.backup,args.restore]] or report.exists():
        raise SystemExit('New separate report path required')
    try:result=verify(args.source,args.backup,args.restore)
    except (ValueError,OSError,sqlite3.Error,KeyError,TypeError):raise SystemExit('Restore verification failed; live source was not replaced') from None
    report.parent.mkdir(parents=True,exist_ok=True)
    with report.open('x',encoding='utf-8') as target:json.dump(result,target,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()

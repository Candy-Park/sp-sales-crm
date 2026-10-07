"""Synthetic mail only: real SQLite and delivery failure boundaries."""
import copy, json, tempfile, unittest, uuid, subprocess, sys, hashlib
from pathlib import Path
from tools import outlook_outbox as module

SCOPE='a'*64
OWNER='a11803c8-01ef-4563-95bb-c0024541be2c'
def mail(key='b'*64, direction='received'):
    return dict(source_key=key,identity_method='internet_message_id',direction=direction,
        subject='Synthetic 100G question',body='100G / 10 km; price unknown.',
        sender='synthetic@example.invalid',recipients='test@example.invalid',
        occurred_at='2026-10-06T04:00:00Z',conversation_key='c'*64,attachments=[])
def batch(*records):
    return dict(version=1,batch_id=str(uuid.uuid4()),scope_key=SCOPE,
        start='2026-09-07T00:00:00+09:00',end='2026-10-07T00:00:00+09:00',records=list(records))

class OutboxTests(unittest.TestCase):
    def test_incremental_today_window_preserves_old_originals_and_receipts(self):
        self.queue.stage(batch(mail())); first=self.queue.pending(SCOPE)[0]
        self.queue.acknowledge(SCOPE,first['source_key'],{k:first[k] for k in ['id','source_key','payload_hash']})
        today=mail('d'*64);today['occurred_at']='2026-10-07T01:00:00Z'
        capture=batch(today)|{'start':'2026-10-07T00:00:00+09:00','end':'2026-10-07T12:00:00+09:00'}
        self.queue.stage(capture)
        self.assertEqual(self.queue.status(SCOPE)['window_start'],'2026-09-07T00:00:00+09:00')
        self.assertEqual(self.queue.status(SCOPE)['window_end'],'2026-10-07T12:00:00+09:00')
        self.queue.stage(batch(mail()))
        self.assertEqual(self.queue.status(SCOPE)['window_end'],'2026-10-07T12:00:00+09:00')
        self.assertEqual(len(self.queue.pending(SCOPE)),1)
        saved=self.queue.connection.execute('select id,receipt from mail_outbox where source_key=?',(first['source_key'],)).fetchone()
        self.assertEqual(saved[0],first['id']);self.assertIsNotNone(saved[1])
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'outbox.sqlite'
        self.assertTrue(callable(getattr(module,'Outbox',None)),'Durable Outlook outbox is missing')
        self.queue=module.Outbox(self.path); self.addCleanup(self.queue.close)
    def test_replay_keeps_original_id_and_one_pending_record(self):
        first=self.queue.stage(batch(mail()))
        record=self.queue.pending(SCOPE)[0]
        self.assertEqual(first,{'inserted':1,'duplicates':0})
        self.assertEqual(self.queue.stage(batch(mail())),{'inserted':0,'duplicates':1})
        self.assertEqual(self.queue.pending(SCOPE)[0]['id'],record['id'])
    def test_restart_keeps_original_body_and_unacknowledged_id(self):
        self.queue.stage(batch(mail())); before=self.queue.pending(SCOPE)[0]
        self.queue.close(); self.queue=module.Outbox(self.path); self.addCleanup(self.queue.close)
        self.assertEqual(self.queue.pending(SCOPE),[before])
        self.assertEqual(before['body'],'100G / 10 km; price unknown.')
    def test_changed_payload_aborts_entire_batch_and_preserves_prior_body(self):
        self.queue.stage(batch(mail())); changed=mail(); changed['body']='changed'
        with self.assertRaises(ValueError):self.queue.stage(batch(mail('d'*64),changed))
        self.assertEqual(len(self.queue.pending(SCOPE)),1)
        self.assertEqual(self.queue.pending(SCOPE)[0]['body'],'100G / 10 km; price unknown.')
    def test_receipt_mismatch_does_not_drop_pending_record(self):
        self.queue.stage(batch(mail())); record=self.queue.pending(SCOPE)[0]
        for receipt in [dict(id=str(uuid.uuid4()),source_key='f'*64,payload_hash=record['payload_hash']),dict(id='not-a-uuid',source_key=record['source_key'],payload_hash=record['payload_hash'])]:
            with self.assertRaises(ValueError):self.queue.acknowledge(SCOPE,record['source_key'],receipt)
        self.assertEqual(len(self.queue.pending(SCOPE)),1)
    def test_valid_receipt_persists_and_conflicting_receipt_is_rejected(self):
        self.queue.stage(batch(mail())); record=self.queue.pending(SCOPE)[0]
        receipt=dict(id=str(uuid.uuid4()),source_key=record['source_key'],payload_hash=record['payload_hash'])
        self.queue.acknowledge(SCOPE,record['source_key'],receipt)
        self.queue.close(); self.queue=module.Outbox(self.path); self.addCleanup(self.queue.close)
        self.assertEqual(self.queue.pending(SCOPE),[])
        self.assertEqual(self.queue.stage(batch(mail())),{'inserted':0,'duplicates':1})
        self.queue.acknowledge(SCOPE,record['source_key'],receipt)
        with self.assertRaises(ValueError):self.queue.acknowledge(SCOPE,record['source_key'],dict(receipt,id=str(uuid.uuid4())))
    def test_owner_binding_prevents_accidental_cross_account_upload(self):
        self.queue.bind_owner(OWNER); self.queue.stage(batch(mail()))
        self.queue.close(); self.queue=module.Outbox(self.path); self.addCleanup(self.queue.close)
        self.queue.bind_owner(OWNER)
        with self.assertRaises(ValueError):self.queue.bind_owner(str(uuid.uuid4()))
    def test_capture_boundaries_invalid_records_and_secrets_are_rejected(self):
        bads=[]
        for key,value in [('direction','draft'),('source_key','raw-outlook-id'),('occurred_at','2026-10-07T00:00:00+09:00'),('occurred_at','2026-02-30T00:00:00Z'),('body',17),('owner_id',OWNER),('access_token','synthetic-secret')]:
            m=mail(); m[key]=value; bads.append(batch(m))
        for b in bads:
            with self.subTest(b=b):
                with self.assertRaises(ValueError):self.queue.stage(b)
        self.assertEqual(self.queue.pending(SCOPE),[])
    def test_identical_keys_in_different_mailboxes_remain_separate(self):
        self.queue.stage(batch(mail())); other=batch(mail()); other['scope_key']='d'*64
        self.queue.stage(other)
        self.assertEqual(len(self.queue.pending(SCOPE)),1)
        self.assertEqual(len(self.queue.pending('d'*64)),1)
    def test_duplicate_internet_id_with_conflicting_mail_is_not_merged(self):
        a=mail(); b=mail(); b['subject']='Different mail with reused message ID'
        with self.assertRaises(ValueError):self.queue.stage(batch(a,b))
        self.assertEqual(self.queue.pending(SCOPE),[])
    def test_lost_response_retries_same_record_then_acknowledges(self):
        self.queue.stage(batch(mail())); calls=[]
        def send(row):
            calls.append(copy.deepcopy(row))
            if len(calls)==1:raise module.DeliveryError(503)
            return dict(id=str(uuid.uuid4()),source_key=row['source_key'],payload_hash=row['payload_hash'])
        report=self.queue.flush(SCOPE,send,wait=lambda seconds:None)
        self.assertEqual(report['delivered'],1); self.assertEqual(report['error'],None)
        self.assertEqual(calls[0],calls[1]); self.assertEqual(self.queue.pending(SCOPE),[])
    def test_auth_and_constraint_failures_stop_without_retry_or_skipping(self):
        for status in [401,403,409,422]:
            with self.subTest(status=status):
                q=module.Outbox(Path(self.temp.name)/f'{status}.sqlite'); self.addCleanup(q.close)
                q.stage(batch(mail(),mail('d'*64))); calls=[]
                def send(row):calls.append(row); raise module.DeliveryError(status)
                report=q.flush(SCOPE,send,wait=lambda seconds:None)
                self.assertEqual(len(calls),1); self.assertEqual(report['error'],f'http_{status}')
                self.assertEqual(len(q.pending(SCOPE)),2)
    def test_transient_errors_stop_after_three_attempts_and_survive_restart(self):
        self.queue.stage(batch(mail())); calls=[]
        def send(row):calls.append(row); raise module.DeliveryError(503)
        report=self.queue.flush(SCOPE,send,wait=lambda seconds:None)
        self.assertEqual(len(calls),3); self.assertEqual(report['delivered'],0)
        self.assertEqual(report['error'],'http_503'); self.assertEqual(len(self.queue.pending(SCOPE)),1)
        self.assertEqual(self.queue.status(SCOPE)['last_error'],'http_503')
    def test_no_successful_sync_checkpoint_until_all_pending_have_receipts(self):
        self.queue.stage(batch(mail())); self.assertIsNone(self.queue.status(SCOPE)['last_success_at'])
        record=self.queue.pending(SCOPE)[0]
        self.queue.flush(SCOPE,lambda row:dict(id=str(uuid.uuid4()),source_key=row['source_key'],payload_hash=row['payload_hash']),wait=lambda seconds:None)
        self.assertIsNotNone(self.queue.status(SCOPE)['last_success_at'])
        self.assertEqual(self.queue.status(SCOPE)['pending'],0)
    def test_long_original_is_preserved_locally_without_truncation(self):
        m=mail(); m['body']='X'*3000000
        self.queue.stage(batch(m))
        original=self.queue.pending(SCOPE)[0]['body']
        self.assertEqual(len(original),3000000)
        self.assertEqual(original,m['body'])
    def test_bool_version_is_not_accepted_as_a_capture_version(self):
        b=batch(mail()); b['version']=True
        with self.assertRaises(ValueError):self.queue.stage(b)
    def test_attachment_only_mail_preserves_an_empty_original(self):
        m=mail(); m['body']=''; m['attachments']=[dict(name='synthetic.pdf',size=42)]
        self.queue.stage(batch(m))
        self.assertEqual(self.queue.pending(SCOPE)[0]['body'],'')
    def test_fallback_identity_and_attachment_metadata_are_preserved_without_download(self):
        m=mail(); m['identity_method']='entry_id_fallback'; m['attachments']=[dict(name='synthetic.pdf',size=42)]
        self.queue.stage(batch(m)); record=self.queue.pending(SCOPE)[0]
        self.assertEqual(record['identity_method'],'entry_id_fallback')
        self.assertEqual(record['attachments'],[dict(name='synthetic.pdf',size=42)])

@unittest.skipUnless(sys.platform=='win32','Windows Outlook collector')
class CaptureHelperTests(unittest.TestCase):
    def run_ps(self,code):
        script=Path(__file__).resolve().parents[1]/'tools'/'outlook_capture.ps1'
        literal=str(script).replace("'","''")
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',
            "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); . '"+literal+"' -LibraryOnly; Get-Command Get-CrmSourceIdentity,Assert-CrmCaptureWindow,Get-CrmScopeKey -ErrorAction Stop | Out-Null; "+code],capture_output=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr.decode('utf-8',errors='replace'))
        return result.stdout.decode('utf-8-sig').strip()
    def test_internet_identity_survives_entry_id_change_and_direction_is_distinct(self):
        code="""$a=Get-CrmSourceIdentity -ScopeKey ('a'*64) -Direction received -InternetMessageId '<same@test.invalid>' -EntryId 'before';
        $b=Get-CrmSourceIdentity -ScopeKey ('a'*64) -Direction received -InternetMessageId '<same@test.invalid>' -EntryId 'after';
        $c=Get-CrmSourceIdentity -ScopeKey ('a'*64) -Direction sent -InternetMessageId '<same@test.invalid>' -EntryId 'before';
        @($a,$b,$c) | ConvertTo-Json -Compress"""
        a,b,c=json.loads(self.run_ps(code))
        self.assertEqual(a['source_key'],b['source_key']); self.assertNotEqual(a['source_key'],c['source_key'])
        self.assertEqual(a['identity_method'],'internet_message_id')
        expected=hashlib.sha256(('a'*64+':received:internet_message_id:<same@test.invalid>').encode()).hexdigest()
        self.assertEqual(a['source_key'],expected)
    def test_missing_internet_id_is_explicit_fallback_and_missing_both_fails(self):
        record=json.loads(self.run_ps("Get-CrmSourceIdentity -ScopeKey ('a'*64) -Direction received -InternetMessageId '' -EntryId 'original' | ConvertTo-Json -Compress"))
        self.assertEqual(record['identity_method'],'entry_id_fallback')
        self.assertEqual(self.run_ps("try{Get-CrmSourceIdentity -ScopeKey ('a'*64) -Direction received -InternetMessageId '' -EntryId '';throw 'accepted'}catch{if($_.Exception.Message -eq 'accepted'){throw};'rejected'}"),'rejected')
    def test_window_rejects_subminute_and_reverse_before_outlook_access(self):
        self.assertEqual(self.run_ps("try{Assert-CrmCaptureWindow ([datetime]'2026-10-06T10:00:30') ([datetime]'2026-10-06T11:00:00');throw 'accepted'}catch{if($_.Exception.Message -eq 'accepted'){throw};'rejected'}"),'rejected')
        self.assertEqual(self.run_ps("try{Assert-CrmCaptureWindow ([datetime]'2026-10-06T11:00:00') ([datetime]'2026-10-06T10:00:00');throw 'accepted'}catch{if($_.Exception.Message -eq 'accepted'){throw};'rejected'}"),'rejected')
    def test_scope_identity_does_not_merge_distinct_mailboxes(self):
        keys=json.loads(self.run_ps("@((Get-CrmScopeKey ' TEST@example.invalid '),(Get-CrmScopeKey 'test@example.invalid'),(Get-CrmScopeKey 'other@example.invalid')) | ConvertTo-Json -Compress"))
        self.assertEqual(keys[0],keys[1]); self.assertNotEqual(keys[0],keys[2]); self.assertRegex(keys[0],r'^[0-9a-f]{64}$')

if __name__=='__main__':unittest.main()

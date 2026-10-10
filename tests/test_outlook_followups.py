import hashlib,json,sys,tempfile,unittest
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_outbox import Outbox,canonical,date
from outlook_followups import scan,read_report

OWNER='00000000-0000-4000-8000-000000000001'
MID='00000000-0000-4000-8000-000000000002'
IID='00000000-0000-4000-8000-000000000003'
def mail(key='a',direction='received',time='2026-10-09T00:00:00Z',conversation='c'):
 return dict(source_key=key*64,identity_method='internet_message_id',direction=direction,subject='SYNTHETIC',body='Please check specification',sender='synthetic@example.test',recipients='synthetic@example.test',occurred_at=time,conversation_key=conversation*64,attachments=[])

class FollowupTests(unittest.TestCase):
 def setUp(self):
  self.folder=tempfile.TemporaryDirectory();self.root=Path(self.folder.name);self.original=self.root/'original.sqlite';self.destination=self.root/'followups.sqlite'
  box=Outbox(self.original);box.bind_owner(OWNER)
  self.base=mail();self.batch=dict(version=1,batch_id=MID,scope_key='d'*64,start='2026-09-07T00:00:00Z',end='2026-10-10T00:00:00Z',records=[self.base])
  box.stage(self.batch);row=box.pending('d'*64)[0];box.acknowledge('d'*64,'a'*64,dict(id=MID,source_key='a'*64,payload_hash=row['payload_hash']));box.close()
  self.targets=[dict(id=MID,scope_key='d'*64,source_key='a'*64,payload_hash=row['payload_hash'],inquiry_id=IID,category='고객 업무',reviewed_at='2026-10-10T01:00:00Z')]
  self.now=datetime(2026,10,10,3,0,tzinfo=timezone.utc)
 def tearDown(self):self.folder.cleanup()
 def capture(self,scope,start,end,keys):
  self.assertEqual(keys,{'c'*64});return self.batch|dict(start=start,end=end,records=[m for m in [self.base,mail('b','sent','2026-10-10T02:00:00Z')] if date(start)<=date(m['occurred_at'])<date(end)])
 def test_same_thread_delta_is_proposal_and_repeat_scan_deduplicates_without_cloud_write(self):
  result=scan(self.original,self.destination,OWNER,self.targets,self.capture,self.now)
  self.assertEqual(result['updates'][0]['later_sent'],1);self.assertEqual(result['updates'][0]['later_received'],0);self.assertFalse(result['auto_apply'])
  second=scan(self.original,self.destination,OWNER,self.targets,self.capture,self.now)
  self.assertEqual(second['stored_records'],2);self.assertEqual(second['updates'][0]['later_sent'],1)
  self.assertNotIn('Please check specification',json.dumps(second));self.assertNotIn('synthetic@example.test',json.dumps(second))
 def test_wrong_owner_or_receipt_never_starts_capture(self):
  before=hashlib.sha256(self.original.read_bytes()).hexdigest()
  for owner,targets in [('00000000-0000-4000-8000-000000000009',self.targets),(OWNER,[self.targets[0]|dict(payload_hash='e'*64)])]:
   with self.assertRaises(ValueError):scan(self.original,self.destination,owner,targets,lambda *args:self.fail('capture must not run'),self.now)
  self.assertEqual(before,hashlib.sha256(self.original.read_bytes()).hexdigest());self.assertFalse(self.destination.exists())
 def test_unrelated_conversation_is_rejected_before_local_storage(self):
  with self.assertRaises(ValueError):scan(self.original,self.destination,OWNER,self.targets,lambda scope,start,end,keys:self.batch|dict(start=start,end=end,records=[mail('b',conversation='e')]),self.now)
  self.assertFalse(self.destination.exists())
 def test_existing_original_conflict_is_not_overwritten(self):
  with self.assertRaises(ValueError):scan(self.original,self.destination,OWNER,self.targets,lambda scope,start,end,keys:self.batch|dict(start=start,end=end,records=[self.base|dict(body='changed')]),self.now)
  self.assertFalse(self.destination.exists())
 def test_cached_report_is_read_only_and_review_baseline_does_not_advance_on_poll(self):
  scan(self.original,self.destination,OWNER,self.targets,self.capture,self.now);before=hashlib.sha256(self.destination.read_bytes()).hexdigest()
  result=read_report(self.original,self.destination,OWNER,[self.targets[0]|dict(reviewed_at='2026-10-10T03:00:00Z')])
  self.assertEqual(result['updates'][0]['later_sent'],1);self.assertEqual(before,hashlib.sha256(self.destination.read_bytes()).hexdigest())

 def test_crm_edit_does_not_skip_unseen_mail_since_original_collection(self):
  result=scan(self.original,self.destination,OWNER,[self.targets[0]|dict(reviewed_at='2026-10-10T02:59:00Z')],self.capture,self.now)
  self.assertEqual(result['updates'][0]['later_sent'],1)
 def test_failed_stage_leaves_recoverable_cache_without_checkpoint(self):
  bad=lambda scope,start,end,keys:self.batch|dict(start=start,end=end,records=[mail('b',time='2026-11-01T00:00:00Z')])
  with self.assertRaises(ValueError):scan(self.original,self.destination,OWNER,self.targets,bad,self.now)
  self.assertFalse(read_report(self.original,self.destination,OWNER,self.targets)['ready'])
  self.assertTrue(scan(self.original,self.destination,OWNER,self.targets,self.capture,self.now)['ready'])
 def test_newly_linked_thread_gets_full_window_not_only_last_five_minutes(self):
  scan(self.original,self.destination,OWNER,self.targets,self.capture,self.now)
  base=mail('e',conversation='e');box=Outbox(self.original);box.stage(self.batch|dict(records=[base]))
  payload_hash=hashlib.sha256(canonical(base).encode()).hexdigest();new_id='00000000-0000-4000-8000-000000000004'
  box.acknowledge('d'*64,'e'*64,dict(id=new_id,source_key='e'*64,payload_hash=payload_hash));box.close()
  targets=self.targets+[self.targets[0]|dict(id=new_id,source_key='e'*64,payload_hash=payload_hash)]
  def capture(scope,start,end,keys):
   self.assertEqual(date(start),date(self.batch['start']));self.assertEqual(keys,{'c'*64,'e'*64})
   return self.batch|dict(start=start,end=end,records=[base,mail('f','sent','2026-10-10T02:00:00Z','e')])
  result=scan(self.original,self.destination,OWNER,targets,capture,self.now)
  self.assertEqual(result['updates'][1]['later_sent'],1)

if __name__=='__main__':unittest.main()

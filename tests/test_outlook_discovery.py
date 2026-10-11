import sys,tempfile,unittest,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_outbox import Outbox
from outlook_discovery import candidate,discover,collect_new,prepare_import,ack_import,stage_batch,communication_event,read_events,choose_customer,local_sources
from unittest.mock import patch
import json

OWNER='00000000-0000-4000-8000-000000000001'
def mail(key='a',**values):
 return dict(source_key=key*64,identity_method='internet_message_id',direction='received',subject='Specification request',body='Please send the specification.',sender='buyer@customer.test',recipients='Candy',occurred_at='2026-10-10T01:00:00Z',conversation_key='c'*64,attachments=[])|values
SETTINGS={'customers':[{'name':'Synthetic customer','domains':['customer.test']}],'hq_domains':['hq.test'],'sender_regions':{'customer.test':'Korea'}}
class DiscoveryTests(unittest.TestCase):
 def test_imported_originals_are_owner_bound_and_sensitive_quotes_are_not_displayed(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'mail.sqlite';box=Outbox(p);box.bind_owner(OWNER)
   value=mail(body='Please check\nFrom: old\nSent: yesterday\nTo: old\nPassword: PRIVATE_QUOTED')
   stage_batch(box,dict(version=1,batch_id=OWNER,scope_key='d'*64,start='2026-10-09T00:00:00Z',end='2026-10-11T00:00:00Z',records=[value]));box.close()
   c=candidate(value,SETTINGS);c.update(customer_id=OWNER,automatic_registration=True)
   plan=prepare_import(p,OWNER,c,'2026-10-11');iid=plan['registration']['id'];ack_import(p,OWNER,'a'*64,iid)
   rows=local_sources(p,OWNER,iid,None)['mails'];self.assertEqual(len(rows),1)
   detail=local_sources(p,OWNER,iid,rows[0]['id'])['mail'];self.assertNotIn('PRIVATE_QUOTED',json.dumps(detail));self.assertTrue(detail['original_held'])
   with self.assertRaises(ValueError):local_sources(p,'00000000-0000-4000-8000-000000000099',iid,None)
 def test_hq_choice_is_remembered_and_reuses_single_import_plan(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'mail.sqlite';box=Outbox(p);box.bind_owner(OWNER)
   stage_batch(box,dict(version=1,batch_id=OWNER,scope_key='d'*64,start='2026-10-09T00:00:00Z',end='2026-10-11T00:00:00Z',records=[mail(sender='Jane@hq.test')]))
   box.close();value=discover([p],OWNER,'d'*64,SETTINGS,set(),set())['candidates'][0]
   self.assertFalse(value['automatic_registration']);choose_customer(p,OWNER,value,OWNER)
   chosen=discover([p],OWNER,'d'*64,SETTINGS,set(),set())['candidates'][0];self.assertTrue(chosen['automatic_registration'])
   plan=prepare_import(p,OWNER,chosen,'2026-10-11');self.assertEqual(plan['message']['kind'],'hq_received');self.assertEqual(plan['registration']['customer_id'],OWNER)
   with self.assertRaises(ValueError):choose_customer(p,OWNER,chosen,OWNER)
 def test_events_respect_confirmed_cutoff_owner_and_original_hash(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'base.sqlite';settings=Path(folder)/'settings.json';settings.write_text(json.dumps(SETTINGS),encoding='utf-8')
   box=Outbox(p);box.bind_owner(OWNER);base=mail(occurred_at='2026-10-09T01:00:00Z');later=mail('b',sender='Jane@hq.test')
   stage_batch(box,dict(version=1,batch_id=OWNER,scope_key='d'*64,start='2026-10-09T00:00:00Z',end='2026-10-11T00:00:00Z',records=[base,later]))
   row=next(r for r in box.pending('d'*64) if r['source_key']==base['source_key']);box.acknowledge('d'*64,base['source_key'],dict(id=OWNER,source_key=base['source_key'],payload_hash=row['payload_hash']));box.close()
   target=dict(id=OWNER,scope_key='d'*64,source_key=base['source_key'],payload_hash=row['payload_hash'],inquiry_id=OWNER,category='고객 업무',reviewed_at='2026-10-11T00:00:00Z')
   before=hashlib.sha256(p.read_bytes()).hexdigest()
   with patch('outlook_discovery.SETTINGS',settings),patch('outlook_discovery.DESTINATION',Path(folder)/'none.sqlite'):
    events=read_events(p,Path(folder)/'follow.sqlite',OWNER,[target],{OWNER:'2026-10-10T00:00:00Z'})
    self.assertEqual(len(events['events']),1);self.assertEqual(events['events'][0]['message']['kind'],'hq_received')
    self.assertEqual(read_events(p,Path(folder)/'follow.sqlite',OWNER,[target],{OWNER:'2026-10-11T00:00:00Z'})['events'],[])
    with self.assertRaises(ValueError):read_events(p,Path(folder)/'follow.sqlite',OWNER,[target],{'untrusted':'2026-10-09T00:00:00Z'})
   self.assertEqual(before,hashlib.sha256(p.read_bytes()).hexdigest())
 def test_actual_party_controls_received_sent_history_and_mixed_recipients_are_held(self):
  event=communication_event(mail(sender='Jane@hq.test'),SETTINGS,{}, {},OWNER,OWNER)
  self.assertEqual(event['message']['kind'],'hq_received');self.assertNotIn('action_id',event['message'])
  sent=mail(direction='sent',sender='Candy@hq.test')
  event=communication_event(sent,SETTINGS,{}, {'a'*64:['customer.test']},OWNER,OWNER)
  self.assertEqual(event['message']['kind'],'customer_sent');self.assertTrue(event['message']['actual_confirmed'])
  self.assertIsNone(communication_event(sent,SETTINGS,{}, {'a'*64:['customer.test','hq.test']},OWNER,OWNER))
  self.assertIsNone(communication_event(mail(body='access token: PRIVATE'),SETTINGS,{}, {},OWNER,OWNER))
 def test_exchange_domain_sidecar_is_local_source_bound_and_never_changes_original(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'mail.sqlite';box=Outbox(p);box.bind_owner(OWNER)
   value=mail(sender='/o=SYNTHETIC Exchange')
   batch=dict(version=1,batch_id=OWNER,scope_key='d'*64,start='2026-10-09T00:00:00Z',end='2026-10-11T00:00:00Z',records=[value],sender_domains={'a'*64:'customer.test'})
   stage_batch(box,batch)
   self.assertEqual(discover([p],OWNER,'d'*64,SETTINGS,set(),set())['candidates'][0]['category'],'고객 업무')
   self.assertEqual(box.pending('d'*64)[0]['sender'],value['sender'])
   with self.assertRaises(ValueError):stage_batch(box,batch|{'sender_domains':{'b'*64:'customer.test'}})
   box.close()
 def test_only_candy_or_confirmed_korea_business_and_no_alerts(self):
  self.assertEqual(candidate(mail(),SETTINGS)['category'],'고객 업무')
  self.assertIsNone(candidate(mail(recipients='Other',sender='foreign@other.test'),SETTINGS))
  self.assertEqual(candidate(mail(recipients='Other'),SETTINGS)['category'],'고객 업무')
  self.assertIsNone(candidate(mail(recipients='Other'),SETTINGS|{'sender_regions':{}}))
  for subject in ['Agile pending approval','Re: DWT - Weekly Digest Report','Expense Report Status Change','New VPN Release Announcement']:
   self.assertIsNone(candidate(mail(subject=subject),SETTINGS))
  self.assertIsNone(candidate(mail(body='Password: SYNTHETIC_SECRET'),SETTINGS))
  self.assertIsNone(candidate(mail(direction='sent'),SETTINGS))
  self.assertIsNone(candidate(mail(conversation_key=None),SETTINGS))
  self.assertEqual(candidate(mail(sender='Jane@hq.test',body='請協助確認交期，謝謝。'),SETTINGS)['category'],'HQ 업무')
 def test_quoted_candy_or_customer_tag_is_not_ownership_evidence(self):
  self.assertIsNone(candidate(mail(recipients='Other',body='Please check\nFrom: Candy\nSent: yesterday\nTo: buyer',subject='[Synthetic customer] request'),SETTINGS|{'sender_regions':{}}))
 def test_cache_discovery_deduplicates_links_and_preserves_originals(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'source.sqlite';box=Outbox(p);box.bind_owner(OWNER)
   batch=dict(version=1,batch_id=OWNER,scope_key='d'*64,start='2026-10-09T00:00:00Z',end='2026-10-11T00:00:00Z',records=[mail(),mail('b',conversation_key='e'*64)])
   box.stage(batch);box.close();before=hashlib.sha256(p.read_bytes()).hexdigest()
   result=discover([p,p],OWNER,'d'*64,SETTINGS,{'c'*64},{'b'*64})
   self.assertEqual(result['candidates'],[]);self.assertEqual(before,hashlib.sha256(p.read_bytes()).hexdigest())
   self.assertEqual(len(discover([p,p],OWNER,'d'*64,SETTINGS,set(),set())['candidates']),2)
   with self.assertRaises(ValueError):discover([p], '00000000-0000-4000-8000-000000000099','d'*64,SETTINGS,set(),set())
 def test_incremental_capture_is_local_and_retry_preserves_checkpoint(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'new.sqlite';calls=[]
   def capture(scope,start,end,keys):
    calls.append((start,end,keys));return dict(version=1,batch_id=OWNER,scope_key=scope,start=start,end=end,records=[mail()])
   collect_new(p,OWNER,'d'*64,'2026-10-09T00:00:00Z','2026-10-11T00:00:00Z',capture)
   collect_new(p,OWNER,'d'*64,'2026-10-09T00:00:00Z','2026-10-11T01:00:00Z',lambda scope,start,end,keys:dict(version=1,batch_id=OWNER,scope_key=scope,start=start,end=end,records=[]))
   self.assertEqual(calls[0][2],set());self.assertEqual(len(discover([p],OWNER,'d'*64,SETTINGS,set(),set())['candidates']),1)
 def test_import_plan_is_owner_bound_stable_across_retries_and_ack_only_after_success(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'new.sqlite';box=Outbox(p);box.bind_owner(OWNER);box.close()
   value=candidate(mail(),SETTINGS);value.update(customer_id=OWNER,automatic_registration=True)
   first=prepare_import(p,OWNER,value,'2026-10-11');second=prepare_import(p,OWNER,value,'2026-10-12')
   self.assertEqual(first,second);self.assertEqual(first['action']['due_date'],'2026-10-14')
   self.assertNotIn('action_id',first['message']);self.assertEqual(first['message']['kind'],'customer_received')
   ack_import(p,OWNER,'a'*64,first['registration']['id'])
   with self.assertRaises(ValueError):ack_import(p,OWNER,'a'*64,'00000000-0000-4000-8000-000000000099')

if __name__=='__main__':unittest.main()

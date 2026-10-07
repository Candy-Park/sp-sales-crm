import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_outbox import Outbox, DeliveryError
from outlook_review_sync import sync_review


class SyncTests(unittest.TestCase):
    def batch(self):
        mail=dict(source_key='a'*64,identity_method='internet_message_id',direction='received',
                  subject='Someone shared INV.pdf',body='PRIVATE_SENTINEL',sender='notice@drive.proton.me',
                  recipients='PRIVATE_ADDRESS',occurred_at='2026-10-07T01:00:00Z',conversation_key=None,attachments=[])
        return dict(version=1,batch_id=str(uuid.uuid4()),scope_key='b'*64,start='2026-10-07T00:00:00+09:00',end='2026-10-07T12:00:00+09:00',records=[mail])

    def test_replay_and_restart_keep_request_ids_and_distinguish_gold(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'outbox.sqlite'; owner=str(uuid.uuid4()); batch=self.batch()
            settings={'confirmed_labels':[{'source_key':'a'*64,'category':'스팸','confirmed_by':'user','confirmed_on':'2026-10-07'}]}
            calls=[]
            def rpc(name,data):
                calls.append((name,data))
                p=data['p_data']
                if name=='sales_ingest_outlook':return {k:p[k] for k in ['id','source_key','payload_hash']}
                if name=='sales_propose_outlook':return dict(id=p['id'],source_key=p['source_key'],mail_id=mail_id)
                return dict(id=p['id'],mail_id=data['p_id'],revision=1,role=p['role'],category=p['category'])
            box=Outbox(path);box.bind_owner(owner);box.stage(batch);mail_id=box.pending('b'*64)[0]['id']
            first=sync_review(box,batch,settings,owner,rpc,wait=lambda _:None);box.close()
            box=Outbox(path)
            try: second=sync_review(box,batch,settings,owner,rpc,wait=lambda _:None)
            finally:box.close()
            self.assertEqual(first['staged']['inserted'],0)
            self.assertEqual(first['review_sync']['proposals'],1)
            self.assertEqual(second['delivery']['delivered'],0)
            proposals=[p['p_data'] for n,p in calls if n=='sales_propose_outlook']
            self.assertEqual(proposals[0],proposals[1])
            self.assertEqual(proposals[0]['category'],'스팸 의심·확인 필요')
            labels=[p['p_data'] for n,p in calls if n=='sales_classify_outlook']
            self.assertEqual(labels[0],labels[1]);self.assertEqual(labels[0]['role'],'미확인')
            encoded=json.dumps(proposals+labels)
            self.assertNotIn('PRIVATE_SENTINEL',encoded);self.assertNotIn('notice@drive.proton.me',encoded)

    def test_response_loss_retries_exact_id_and_seed_conflict_preserves_later_decision(self):
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'outbox.sqlite');owner=str(uuid.uuid4());batch=self.batch();box.bind_owner(owner)
            seen=[]
            def rpc(name,data):
                p=data['p_data']
                if name=='sales_ingest_outlook':return {k:p[k] for k in ['id','source_key','payload_hash']}
                if name=='sales_propose_outlook':
                    seen.append(p)
                    if len(seen)==1:raise OSError('lost response')
                    return dict(id=p['id'],source_key=p['source_key'],mail_id=box.connection.execute('select id from mail_outbox').fetchone()[0])
                raise DeliveryError(409)
            try:
                result=sync_review(box,batch,{'confirmed_labels':[{'source_key':'a'*64,'category':'스팸','confirmed_by':'user'}]},owner,rpc,wait=lambda _:None)
                self.assertEqual(seen[0],seen[1]);self.assertEqual(result['review_sync']['preserved_labels'],1)
            finally:box.close()

    def test_failed_ingest_stops_before_classification_and_foreign_owner_is_denied(self):
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'outbox.sqlite');owner=str(uuid.uuid4());calls=[]
            def rpc(name,data):calls.append(name);raise DeliveryError(401)
            try:
                result=sync_review(box,self.batch(),{},owner,rpc,wait=lambda _:None)
                self.assertEqual(calls,['sales_ingest_outlook']);self.assertEqual(result['review_sync']['proposals'],0)
                with self.assertRaises(ValueError):sync_review(box,self.batch(),{},str(uuid.uuid4()),rpc)
            finally:box.close()

    def test_invalid_proposal_receipt_never_reports_success(self):
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'outbox.sqlite');owner=str(uuid.uuid4())
            def rpc(name,data):
                p=data['p_data']
                return {k:p[k] for k in ['id','source_key','payload_hash']} if name=='sales_ingest_outlook' else {'id':str(uuid.uuid4())}
            try:
                result=sync_review(box,self.batch(),{},owner,rpc)
                self.assertEqual(result['review_sync']['proposals'],0)
                self.assertEqual(result['review_sync']['error'],'invalid_receipt')
            finally:box.close()

    def test_520_retries_same_proposal_and_stops_after_three_attempts(self):
        from outlook_review_sync import retry
        seen=[];data={'p_data':{'id':str(uuid.uuid4())}}
        def rpc(name,value):
            seen.append(value)
            if len(seen)==1:raise DeliveryError(520)
            return {'id':value['p_data']['id']}
        result=retry(rpc,'sales_propose_outlook',data,lambda _:None)
        self.assertEqual(result['id'],data['p_data']['id']);self.assertEqual(seen[0],seen[1])
        calls=[]
        def failing(name,value):calls.append(value);raise DeliveryError(520)
        with self.assertRaises(DeliveryError):retry(failing,'sales_propose_outlook',data,lambda _:None)
        self.assertEqual(len(calls),3)

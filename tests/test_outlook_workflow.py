import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_review import newest_text
from outlook_workflow import propose, read_workflow
from outlook_outbox import Outbox, canonical

OWNER='00000000-0000-4000-8000-000000000001'
def mail(body='Please confirm specification', key='a', direction='received', time='2026-10-06T01:00:00Z', conversation='c'):
    return dict(source_key=key*64, identity_method='internet_message_id', direction=direction,
                subject='SYNTHETIC', body=body, sender='person@example.test', recipients='PRIVATE_RECIPIENT',
                occurred_at=time, conversation_key=conversation*64 if conversation else None, attachments=[])

class WorkflowTests(unittest.TestCase):
    def test_chinese_requests_and_partial_answers_preserve_unresolved_work(self):
        m=mail('請協助確認交期，謝謝。');result=propose(m,[m],'HQ 업무')
        self.assertEqual((result['work_kind'],result['stage']),('납기 확인','요청 후보'));self.assertFalse(result['auto_apply'])
        m=mail('交期尚未確認，稍後回覆。');result=propose(m,[m],'HQ 업무')
        self.assertEqual(result['stage'],'중간 답변 후보');self.assertFalse(result['auto_apply'])
    def test_multilingual_quoted_request_is_not_latest(self):
        for header in ['发件人： old\n发送时间： yesterday\n收件人： Candy\n主题： request',
                       '보낸 사람: old\n날짜: yesterday\n제목: request',
                       'From: old\nDate: yesterday\nSubject: request',
                       '-----原始邮件-----']:
            self.assertEqual(newest_text('Current answer\n'+header+'\nPlease confirm'), 'Current answer')
        self.assertEqual(newest_text('Quarantine\nFrom: x\nSubject: request'), 'Quarantine\nFrom: x\nSubject: request')

    def test_partial_lead_time_wait_is_proposal_never_confirmed(self):
        m=mail('Sourcing needs to confirm material lead time. We will update module lead time later.')
        result=propose(m,[m],'HQ 업무')
        self.assertEqual((result['work_kind'],result['stage'],result['waiting_on']),('납기 확인','중간 답변 후보','HQ 확인 필요'))
        self.assertTrue(result['proposed'])
        self.assertFalse(result['auto_apply'])

    def test_stock_reply_and_sent_mail_do_not_claim_shipped_or_customer_recipient(self):
        m=mail('Yes, we have them in stock.')
        sent=mail('공급 가능합니다.',key='b',direction='sent',time='2026-10-06T02:00:00Z')
        result=propose(m,[m,sent],'HQ 업무')
        self.assertEqual(result['work_kind'],'재고 확인')
        self.assertEqual(result['later_sent'],1)
        self.assertIn('수신 상대',result['next_action'])
        self.assertIn('출하', ' '.join(result['caveats']))
        self.assertNotIn('PRIVATE_RECIPIENT',json.dumps(result))
        self.assertNotIn(m['body'],json.dumps(result))

    def test_negative_stock_is_not_positive_final_answer(self):
        m=mail('We do not have these in stock. Please check alternatives.')
        result=propose(m,[m],'HQ 업무')
        self.assertEqual(result['stage'],'추가 확인 후보')

    def test_invoice_submission_observed_does_not_mean_approval_payment(self):
        m=mail('Please provide the approved invoice.')
        sent=mail('Please check attached invoice.',key='b',direction='sent',time='2026-10-06T02:00:00Z')
        result=propose(m,[m,sent],'HQ 업무')
        self.assertEqual(result['work_kind'],'청구·정산')
        self.assertIn('승인', ' '.join(result['caveats']))
        self.assertEqual(result['stage'],'요청 후보')

    def test_invoice_request_with_negative_expense_condition_is_still_request_not_answer(self):
        m=mail('Please provide invoice. Do not include unapproved expenses.')
        result=propose(m,[m],'HQ 업무')
        self.assertEqual(result['stage'],'요청 후보')
        self.assertIn('제약', ' '.join(result['evidence']))

    def test_scope_direction_conversation_time_and_unknown_conversation_guard(self):
        m=mail('Please check specifications')
        earlier=mail(key='b',direction='sent',time='2026-10-05T01:00:00Z')
        wrong=mail(key='d',direction='sent',time='2026-10-06T02:00:00Z',conversation='e')
        result=propose(m,[m,earlier,wrong],'HQ 업무')
        self.assertEqual(result['later_sent'],0)
        unknown=mail(conversation=None)
        self.assertEqual(propose(unknown,[unknown,earlier],'HQ 업무')['thread_count'],1)
        later=mail(key='f',time='2026-10-06T03:00:00Z')
        self.assertEqual(propose(m,[later,m],'HQ 업무')['stage'],'이후 수신 재검토 필요')

    def test_spam_notification_and_held_never_create_business_work(self):
        for category in ['스팸','광고','뉴스레터','업무 알림','보안 알림']:
            result=propose(mail(),[mail()],category)
            self.assertEqual(result['stage'],'별도 검토')
        held=mail('x'*100001)
        self.assertEqual(propose(held,[held],'HQ 업무')['stage'],'긴 본문 보류')

    def test_local_read_checks_owner_identity_receipt_and_hash_without_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'outbox.sqlite'
            box=Outbox(path);box.bind_owner(OWNER)
            batch=dict(version=1,batch_id='00000000-0000-4000-8000-000000000003',scope_key='d'*64,start='2026-10-01T00:00:00Z',end='2026-10-07T00:00:00Z',records=[mail()])
            try:
                box.stage(batch);row=box.pending(batch['scope_key'])[0]
                receipt={k:row[k] for k in ['id','source_key','payload_hash']};box.acknowledge(batch['scope_key'],row['source_key'],receipt)
            finally:box.close()
            identity={k:row[k] for k in ['id','scope_key','source_key','payload_hash']}
            before=hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(read_workflow(path,OWNER,identity,'HQ 업무')['stage'],'요청 후보')
            for owner,bad in [('00000000-0000-4000-8000-000000000002',identity),(OWNER,identity|{'id':'00000000-0000-4000-8000-000000000099'}),(OWNER,identity|{'payload_hash':'e'*64})]:
                with self.assertRaises(ValueError):read_workflow(path,owner,bad,'HQ 업무')
            self.assertEqual(before,hashlib.sha256(path.read_bytes()).hexdigest())
            with closing(sqlite3.connect(path)) as c:
                with c:c.execute("UPDATE mail_outbox SET payload='{}'")
            with self.assertRaises(ValueError):read_workflow(path,OWNER,identity,'HQ 업무')

    def test_recovered_server_receipt_id_can_differ_from_fresh_local_request_id(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'outbox.sqlite';box=Outbox(path)
            try:
                box.bind_owner(OWNER)
                batch=dict(version=1,batch_id='00000000-0000-4000-8000-000000000003',scope_key='d'*64,start='2026-10-01T00:00:00Z',end='2026-10-07T00:00:00Z',records=[mail()])
                box.stage(batch);row=box.pending(batch['scope_key'])[0]
                receipt={k:row[k] for k in ['id','source_key','payload_hash']}|{'id':'00000000-0000-4000-8000-000000000099'}
                box.acknowledge(batch['scope_key'],row['source_key'],receipt)
            finally:box.close()
            self.assertEqual(read_workflow(path,OWNER,receipt|{'scope_key':batch['scope_key']},'HQ 업무')['stage'],'요청 후보')

if __name__=='__main__':unittest.main()

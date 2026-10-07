import json
import sys
import unittest
import subprocess
import tempfile
import hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_review import review, report
from outlook_outbox import Outbox


class ReviewTests(unittest.TestCase):
    def mail(self, subject='확인', sender='sender@example.test', body='PRIVATE_BODY_SENTINEL'):
        return dict(source_key='a'*64, identity_method='internet_message_id', direction='received',
                    subject=subject, sender=sender, recipients='PRIVATE_ADDRESS_SENTINEL', body=body,
                    occurred_at='2026-10-07T01:00:00Z', conversation_key=None, attachments=[])

    def test_report_does_not_export_body_or_addresses_or_confirm_candidates(self):
        batch=dict(start='2026-10-07T00:00:00+09:00', end='2026-10-07T12:00:00+09:00', records=[self.mail()])
        result=report(batch, {}); encoded=json.dumps(result)
        self.assertNotIn('PRIVATE_BODY_SENTINEL', encoded)
        self.assertNotIn('PRIVATE_ADDRESS_SENTINEL', encoded)
        self.assertNotIn('sender@example.test', encoded)
        self.assertEqual(result['confirmed_labels'], 0)
        self.assertEqual(result['rows'][0]['review_status'], 'proposed')

    def test_quoted_customer_and_hq_do_not_classify_latest_mail(self):
        mail=self.mail(body='안녕하세요\nFrom: prior\nSent: earlier\nTo: recipient\n요청 광모듈 [EXM] HQ')
        settings={'customers':[{'name':'TestCustomer','aliases':['EXM']}], 'hq_domains':['internal.test']}
        self.assertEqual(review(mail, settings)['category'], '판단 보류')

    def test_customer_alias_is_exact_tag_and_does_not_autolink(self):
        settings={'customers':[{'name':'TestCustomer','aliases':['EXM']}]}
        self.assertEqual(review(self.mail(subject='Re: [EXM] 사양서'),settings)['customer'],'TestCustomer')
        self.assertIsNone(review(self.mail(subject='[EXM-OTHER] 사양서'),settings)['customer'])
        self.assertEqual(review(self.mail(subject='[EXM] 사양서'),settings)['confirmed_category'],None)

    def test_security_domain_must_be_exact_and_sharing_is_not_confirmed_spam(self):
        self.assertEqual(review(self.mail(subject='격리',sender='notice@messaging.microsoft.com'),{})['category'],'보안 알림')
        self.assertEqual(review(self.mail(subject='격리',sender='notice@messaging.microsoft.com.bad.test'),{})['category'],'판단 보류')
        self.assertEqual(review(self.mail(subject='Someone shared INV.pdf',sender='notice@drive.proton.me'),{})['confidence'],'낮음')

    def test_wrong_direction_or_window_is_rejected(self):
        batch=dict(start='2026-10-07T00:00:00+09:00',end='2026-10-07T12:00:00+09:00',records=[self.mail()|{'direction':'sent'}])
        with self.assertRaises(ValueError): report(batch,{})
        batch['records']=[self.mail()|{'occurred_at':'2026-10-07T12:00:00+09:00'}]
        with self.assertRaises(ValueError): report(batch,{})

    def test_user_correction_applies_only_to_exact_mail_not_entire_domain(self):
        settings={'confirmed_labels':[{'source_key':'a'*64,'category':'스팸','confirmed_by':'user'}]}
        mail=self.mail(subject='Someone shared INV.pdf',sender='notice@drive.proton.me')
        result=review(mail,settings)
        self.assertEqual(result['review_status'],'user_confirmed')
        self.assertEqual(result['confirmed_category'],'스팸')
        self.assertEqual(review(mail|{'source_key':'b'*64},settings)['category'],'스팸 의심·확인 필요')
        settings['confirmed_labels'][0]['confirmed_by']='model'
        with self.assertRaises(ValueError): review(mail,settings)

    def test_hq_shipment_notification_is_business_alert_not_human_hq_answer(self):
        settings={'hq_domains':['internal.test']}
        result=review(self.mail(subject='Product Shipment Notification for Customer',sender='notice@internal.test',body='Shipment details'),settings)
        self.assertEqual(result['category'],'업무 알림')
        self.assertEqual(result['role'],'HQ 자동 알림 후보')

    def test_hq_ecn_workflow_and_expense_notification_are_not_spam(self):
        settings={'hq_domains':['internal.test']}
        result=review(self.mail(subject='ISO/TL ECN has been moved to Released status of workflow.',sender='notice@internal.test'),settings)
        self.assertEqual(result['category'],'업무 알림')
        expense=review(self.mail(subject='Expense Report Status Change',sender='notice@concursolutions.com'),settings)
        self.assertEqual(expense['category'],'업무 알림')

    def test_hq_human_request_is_not_replaced_by_old_quoted_notification(self):
        result=review(self.mail(subject='Re: Please review',sender='person@internal.test',body='Please confirm the transceiver specification\nFrom: notice\nProduct Shipment Notification'),{'hq_domains':['internal.test']})
        self.assertEqual(result['category'],'HQ 업무 후보')

    def test_subject_customer_tag_with_unknown_sender_is_only_candidate(self):
        result=review(self.mail(subject='[EXM] specs',sender='person@unknown.test'),{'customers':[{'name':'TestCustomer','aliases':['EXM']}]})
        self.assertEqual(result['confidence'],'중간')
        self.assertEqual(result['category'],'고객 업무 후보')

    def test_newsletter_with_unsubscribe_is_candidate_not_confirmed_spam(self):
        result=review(self.mail(subject='tp:today - optical networking news',sender='news@mail.telecompaper.com',body='Daily newsletter. Unsubscribe'),{})
        self.assertEqual(result['category'],'뉴스레터 후보')
        self.assertIsNone(result['confirmed_category'])

    def test_quarantine_list_from_label_does_not_claim_thread_boundary(self):
        result=review(self.mail(subject='격리',sender='notice@messaging.microsoft.com',body='Quarantine summary\nFrom: customer\nSubject: request'),{})
        self.assertNotIn('이전 인용문과 최신 본문을 구분',result['evidence'])

    def test_exchange_sender_domain_resolution_is_exact_source_key_only(self):
        settings={'hq_domains':['internal.test'],'resolved_domains':{'a'*64:'internal.test'}}
        mail=self.mail(sender='/o=SyntheticExchange/ou=Group/cn=Recipients/cn=opaque')
        self.assertEqual(review(mail,settings)['category'],'HQ 업무 후보')
        self.assertEqual(review(mail|{'source_key':'b'*64},settings)['category'],'판단 보류')
        self.assertEqual(mail['sender'],'/o=SyntheticExchange/ou=Group/cn=Recipients/cn=opaque')
        settings['resolved_domains']['a'*64]='full-address@internal.test'
        with self.assertRaises(ValueError): review(mail,settings)

    def test_cli_combines_existing_received_and_new_capture_without_changing_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); queue=root/'outbox.sqlite'; capture=root/'capture.json'; output=root/'report.json'; settings=root/'settings.json'
            batch=dict(version=1,batch_id='00000000-0000-4000-8000-000000000071',scope_key='f'*64,start='2026-10-06T00:00:00+09:00',end='2026-10-07T12:00:00+09:00',records=[self.mail(),self.mail()|{'source_key':'c'*64,'direction':'sent'}])
            box=Outbox(queue);box.bind_owner('00000000-0000-4000-8000-000000000072');box.stage(batch);box.close()
            before=hashlib.sha256(queue.read_bytes()).digest()
            capture.write_text(json.dumps(batch|{'start':'2026-10-07T00:00:00+09:00','records':[self.mail(),self.mail()|{'source_key':'b'*64}]}),encoding='utf-8')
            settings.write_text('{}',encoding='utf-8')
            result=subprocess.run([sys.executable,str(Path(__file__).resolve().parent.parent/'tools/outlook_review.py'),'--capture',str(capture),'--settings',str(settings),'--outbox',str(queue),'--output',str(output)],capture_output=True)
            self.assertEqual(result.returncode,0,'Review must merge read-only queue and capture')
            data=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(data['reviewed_candidates'],2)
            self.assertEqual(hashlib.sha256(queue.read_bytes()).digest(),before)
            self.assertNotIn('PRIVATE_BODY_SENTINEL',json.dumps(data))
            # A changed original with the same identity must not silently win.
            capture.write_text(json.dumps(batch|{'records':[self.mail(body='conflicting original')]}),encoding='utf-8')
            rejected=subprocess.run([sys.executable,str(Path(__file__).resolve().parent.parent/'tools/outlook_review.py'),'--capture',str(capture),'--settings',str(settings),'--outbox',str(queue),'--output',str(root/'bad.json')],capture_output=True)
            self.assertNotEqual(rejected.returncode,0)
            self.assertFalse((root/'bad.json').exists())

    def test_hq_sender_with_customer_tag_is_hq_not_customer_sender(self):
        result=review(self.mail(subject='Re: [EXM] specs',sender='person@internal.test'),{'hq_domains':['internal.test'],'customers':[{'name':'TestCustomer','aliases':['EXM']}]})
        self.assertEqual(result['role'],'HQ 후보')
        self.assertEqual(result['customer'],'TestCustomer')

    def test_agile_approval_reminder_is_alert_but_reply_is_hq_work_candidate(self):
        settings={'hq_domains':['internal.test']}
        mail=self.mail(subject='Agile簽核拖延提醒（CAP ECN）: 等待審核時間已超過14天！',sender='notice@internal.test')
        self.assertEqual(review(mail,settings)['category'],'업무 알림')
        self.assertEqual(review(mail|{'subject':'Re: '+mail['subject'],'body':'Please confirm action'},settings)['category'],'HQ 업무 후보')

    def test_user_role_correction_is_distinct_from_referenced_customer(self):
        settings={'customers':[{'name':'TestCustomer','aliases':['EXM']}],'confirmed_labels':[{'source_key':'a'*64,'category':'HQ 업무','role':'HQ','confirmed_by':'user'}]}
        result=review(self.mail(subject='[EXM] specs',sender='person@unknown.test'),settings)
        self.assertEqual(result['role'],'HQ')
        self.assertEqual(result['customer'],'TestCustomer')
        self.assertEqual(result['proposed_role'],'고객사 후보')
        settings['confirmed_labels'][0]['role']='arbitrary'
        with self.assertRaises(ValueError):review(self.mail(),settings)

    def test_subject_email_address_is_redacted_in_export(self):
        result=review(self.mail(subject='Contact person@example.test'),{})
        self.assertNotIn('person@example.test',json.dumps(result))

    def test_parenthesized_customer_tag_is_reference_not_hq_sender_role(self):
        settings={'hq_domains':['internal.test'],'customers':[{'name':'TestCustomer','aliases':['EXM']}]}
        result=review(self.mail(subject='Re: (EXM) module status',sender='person@internal.test'),settings)
        self.assertEqual(result['customer'],'TestCustomer')
        self.assertEqual(result['role'],'HQ 후보')


if __name__=='__main__': unittest.main()

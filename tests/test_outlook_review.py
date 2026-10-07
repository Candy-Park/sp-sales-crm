import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'tools'))
from outlook_review import review, report


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
        mail=self.mail(body='안녕하세요\nFrom: prior\n요청 광모듈 [EXM] HQ')
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


if __name__=='__main__': unittest.main()

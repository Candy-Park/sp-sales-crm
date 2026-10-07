"""Offline review candidates, never training, sending, excluding or linking mail.

Bodies are used only in memory for signals. Reports contain no bodies or addresses.
Customer aliases and domains must come from separately confirmed local settings.
"""
import argparse
import json
import re
from collections import Counter
from datetime import timedelta, timezone
from pathlib import Path

from outlook_outbox import date, digest, valid_mail

SEOUL = timezone(timedelta(hours=9))
CONFIRMED_CATEGORIES = {'고객 업무', 'HQ 업무', '보안 알림', '업무 알림', '광고', '스팸', '판단 보류'}


def newest_text(body):
    return re.split(r'(?im)^\s*(?:From:|보낸\s*사람\s*:|-----Original Message-----|On .{5,180}wrote:)', body, maxsplit=1)[0]


def domain_of(sender):
    match = re.fullmatch(r'[^\s<>@]+@([a-zA-Z0-9.-]+)', sender.strip())
    return match[1].lower() if match else None


def review(mail, settings):
    subject = mail['subject']
    domain = domain_of(mail['sender'])
    top = newest_text(mail['body'])
    signals = []
    request = bool(re.search(r'요청|문의|회신|확인\s*부탁|\b(request|please|quotation)\b', top, re.I))
    product = bool(re.search(r'광모듈|사양|위성|\b(?:LR4|SR4|QSFP\w*|transceiver|100G|400G)\b', subject+' '+top, re.I))
    if request: signals.append('최신 본문에 요청·문의·회신 표현')
    if product: signals.append('제품·사양 관련 표현')
    if len(top) < len(mail['body']): signals.append('이전 인용문과 최신 본문을 구분')
    customer = None
    for item in settings.get('customers', []):
        names = [item['name'], *item.get('aliases', [])]
        # Match a subject tag or configured domain, never a name in quoted mail.
        tagged = any(re.search(r'\['+re.escape(name)+r'\]', subject, re.I) for name in names)
        if tagged or domain in item.get('domains', []):
            customer = item['name']; signals.append('사용자 확인 고객 별칭과 일치'); break
    role, category, confidence = '미확인', '판단 보류', '낮음'
    action = '발신자 관계와 목적 확인 후 분류'
    if domain == 'messaging.microsoft.com' and re.search(r'격리|quarantin', subject, re.I):
        role, category, confidence = '시스템', '보안 알림', '높음'
        signals.append('Microsoft 알림 도메인·격리 제목 일치')
        action = '고객 문의와 분리; 격리된 개별 메일은 별도 판단'
    elif domain == 'drive.proton.me' and re.search(r'\bshared\b', subject, re.I):
        role, category, confidence = '외부·관계 미확인', '스팸 의심·확인 필요', '낮음'
        signals.append('외부 파일 공유 알림; 업무 관계 미확인')
        action = '예정된 공유인지 확인; 자동 제외·링크 열기 보류'
    elif customer:
        role, category, confidence = '고객사', '고객 업무', '높음'
        action = '기존 문의 연결 후보 검토; 제목만으로 연결하지 않음'
    elif domain and domain in settings.get('hq_domains', []):
        role, category, confidence = 'HQ 후보', 'HQ 업무 후보', '중간'
        signals.append('확인된 HQ 도메인과 일치; 발신 인증은 미검증')
        action = '업무 내용·담당자 확인 후 HQ 업무로 확정'
    elif request and product and re.search(r'문의|요청|\brequest\b', subject, re.I):
        role, category, confidence = '고객사 후보', '고객 업무 후보', '중간'
        action = '고객사 관계 확인 후 신규 또는 기존 문의 연결 검토'
    result = dict(source_key=mail['source_key'], time_seoul=date(mail['occurred_at']).astimezone(SEOUL).isoformat(),
                subject=subject, sender_domain=domain, customer=customer, role=role,
                category=category, confidence=confidence, evidence=signals, next_action=action,
                body_length=len(mail['body']), attachment_count=len(mail['attachments']),
                review_status='proposed', confirmed_category=None)
    for label in settings.get('confirmed_labels', []):
        if digest(label['source_key']) != mail['source_key']: continue
        if label['category'] not in CONFIRMED_CATEGORIES or label.get('confirmed_by') != 'user':
            raise ValueError('Explicit user label required')
        result.update(proposed_category=category, category=label['category'], confirmed_category=label['category'],
                      review_status='user_confirmed', confidence='사용자 확정')
        result['evidence'].append('사용자가 이 메일의 분류를 확인')
        if label['category'] == '스팸':
            result['next_action'] = '학습·평가용 스팸 사례로 기록; CRM 제외·삭제는 별도 처리'
    return result


def report(batch, settings):
    start, end = date(batch['start']), date(batch['end'])
    rows = []
    for value in sorted(batch['records'], key=lambda item: item['occurred_at']):
        mail = valid_mail(value, start, end)
        if mail['direction'] != 'received': raise ValueError('Received-only review required')
        rows.append(review(mail, settings))
    return dict(version=1, scope='Inbox received only; not Junk or whole mailbox',
                start_seoul=start.astimezone(SEOUL).isoformat(), end_exclusive_seoul=end.astimezone(SEOUL).isoformat(),
                reviewed_candidates=len(rows), counts=dict(Counter(row['category'] for row in rows)),
                basis='Subject, sender domain and local body signals; attachments not opened; sender authentication not verified',
                model_training=False, external_ai_calls=0, server_uploads=0, crm_changes=0,
                confirmed_labels=sum(row['review_status']=='user_confirmed' for row in rows), rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    batch = json.loads(args.capture.read_text(encoding='utf-8-sig'))
    settings = json.loads(args.settings.read_text(encoding='utf-8-sig'))
    result = report(batch, settings)
    # Exclusive creation: earlier review and corrections must never be overwritten.
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: result[key] for key in ['reviewed_candidates', 'counts', 'external_ai_calls', 'server_uploads', 'crm_changes']}, ensure_ascii=False))


if __name__ == '__main__': main()

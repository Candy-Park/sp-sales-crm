"""Offline review candidates, never training, sending, excluding or linking mail.

Bodies are used only in memory for signals. Reports contain no bodies or addresses.
Customer aliases and domains must come from separately confirmed local settings.
"""
import argparse
import json
import re
import sqlite3
import hashlib
from contextlib import closing
from collections import Counter
from datetime import timedelta, timezone
from pathlib import Path

from outlook_outbox import date, digest, valid_mail, canonical

SEOUL = timezone(timedelta(hours=9))
CONFIRMED_CATEGORIES = {'고객 업무', 'HQ 업무', '외부 협력 업무', '보안 알림', '업무 알림', '뉴스레터', '광고', '스팸', '판단 보류'}
CONFIRMED_ROLES = {'고객사', 'HQ', '업무 시스템', '시스템', '외부 협력사', '외부', '미확인'}


def newest_text(body):
    # A quarantine table can contain From/Subject labels without being a reply.
    boundary = re.search(r'(?im)^\s*(?:-{2,}\s*(?:Original Message|原始邮件|原始郵件|原始訊息)\s*-{2,}|On .{5,180}wrote:)', body)
    candidates = [boundary.start()] if boundary else []
    for header in re.finditer(r'(?im)^\s*(?:From|보낸\s*사람|발신|发件人|寄件者|寄件人|發件人|發件者)\s*[:：]', body):
        block = body[header.end():header.end()+1500]
        if re.search(r'(?im)^\s*(?:Sent|Date|날짜|보낸\s*날짜|보낸\s*시간|发送时间|傳送時間|传送时间|寄件日期|日期|時間|时间)\s*[:：]', block) and re.search(r'(?im)^\s*(?:To|받는\s*사람|수신|Subject|제목|收件人|收件者|主题|主旨)\s*[:：]', block):
            candidates.append(header.start())
    return body[:min(candidates)].rstrip() if candidates else body


def domain_of(sender):
    match = re.fullmatch(r'[^\s<>@]+@([a-zA-Z0-9.-]+)', sender.strip())
    return match[1].lower() if match else None


def review(mail, settings):
    subject = mail['subject']
    domain = domain_of(mail['sender'])
    resolved = settings.get('resolved_domains', {}).get(mail['source_key'])
    if domain is None and resolved is not None:
        if not isinstance(resolved, str) or not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}', resolved):
            raise ValueError('Domain-only resolution required')
        domain = resolved
    top = newest_text(mail['body'])
    signals = []
    if resolved is not None and domain_of(mail['sender']) is None:
        signals.append('별도 읽기 전용 발신 도메인 확인; 원본 발신 표기는 보존')
    request = bool(re.search(r'요청|문의|회신|확인\s*부탁|\b(request|please|quotation)\b', top, re.I))
    product = bool(re.search(r'광모듈|사양|위성|\b(?:LR4|SR4|QSFP\w*|transceiver|100G|400G)\b', subject+' '+top, re.I))
    if request: signals.append('최신 본문에 요청·문의·회신 표현')
    if product: signals.append('제품·사양 관련 표현')
    if len(top) < len(mail['body']): signals.append('이전 인용문과 최신 본문을 구분')
    customer = None
    for item in settings.get('customers', []):
        names = [item['name'], *item.get('aliases', [])]
        # Match a subject tag or configured domain, never a name in quoted mail.
        tagged = any(re.search(r'(?:\['+re.escape(name)+r'\]|\('+re.escape(name)+r'\))', subject, re.I) for name in names)
        if tagged or domain in item.get('domains', []):
            customer = item['name']; signals.append('사용자 확인 고객 별칭과 일치'); break
    role, category, confidence = '미확인', '판단 보류', '낮음'
    action = '발신자 관계와 목적 확인 후 분류'
    if domain == 'messaging.microsoft.com' and re.search(r'격리|quarantin', subject, re.I):
        role, category, confidence = '시스템', '보안 알림', '높음'
        signals.append('Microsoft 알림 도메인·격리 제목 일치')
        action = '고객 문의와 분리; 격리된 개별 메일은 별도 판단'
    elif domain == 'concursolutions.com' and subject.strip().lower() == 'expense report status change':
        role, category, confidence = '업무 시스템', '업무 알림', '높음'
        signals.append('경비 시스템 도메인·상태 변경 제목 일치')
        action = '경비 처리 상태 확인; 고객 문의·HQ 답변과 분리'
    elif domain in settings.get('hq_domains', []) and re.search(r'^(?:ISO/TL ECN .+workflow|Agile簽核拖延提醒|(?:SourcePhotonics )?(?:Tracking Details|Product Shipment Notification|Order Receipt Notification)|DWT - Weekly Digest Report)', subject, re.I):
        role, category, confidence = 'HQ 자동 알림 후보', '업무 알림', '중간'
        signals.append('HQ 도메인과 출하·주문·ECN·주간 보고 제목 일치')
        action = '업무 관련 알림으로 검토; 담당자의 직접 답변·질문 완료와 구분'
    elif domain == 'drive.proton.me' and re.search(r'\bshared\b', subject, re.I):
        role, category, confidence = '외부·관계 미확인', '스팸 의심·확인 필요', '낮음'
        signals.append('외부 파일 공유 알림; 업무 관계 미확인')
        action = '예정된 공유인지 확인; 자동 제외·링크 열기 보류'
    elif domain and domain in settings.get('hq_domains', []):
        role, category, confidence = 'HQ 후보', 'HQ 업무 후보', '중간'
        signals.append('확인된 HQ 도메인과 일치; 발신 인증은 미검증')
        action = '업무 내용·담당자 확인 후 HQ 업무로 확정'
    elif customer:
        role, category, confidence = '고객사 후보', '고객 업무 후보', '중간'
        action = '기존 문의 연결 후보 검토; 제목만으로 연결하지 않음'
    elif request and product and re.search(r'문의|요청|\brequest\b', subject, re.I):
        role, category, confidence = '고객사 후보', '고객 업무 후보', '중간'
        action = '고객사 관계 확인 후 신규 또는 기존 문의 연결 검토'
    elif domain == 'mail.telecompaper.com' and subject.lower().startswith('tp:today') and re.search(r'\bunsubscribe\b|\bnewsletter\b|수신\s*거부', top, re.I):
        role, category, confidence = '외부 매체', '뉴스레터 후보', '중간'
        signals.append('매체 도메인·정기 소식 제목·구독 표현 일치')
        action = '업계 소식과 고객/HQ 직접 업무를 구분; 업무 필요 여부 검토'
    safe_subject = re.sub(r'[^\s<>@]+@[a-zA-Z0-9.-]+', '[메일 주소 생략]', subject)
    result = dict(source_key=mail['source_key'], time_seoul=date(mail['occurred_at']).astimezone(SEOUL).isoformat(),
                subject=safe_subject, sender_domain=domain, customer=customer, role=role,
                category=category, confidence=confidence, evidence=signals, next_action=action,
                body_length=len(mail['body']), local_body_held=len(mail['body'])>100000, attachment_count=len(mail['attachments']),
                review_status='proposed', confirmed_category=None, confirmed_role=None)
    for label in settings.get('confirmed_labels', []):
        if digest(label['source_key']) != mail['source_key']: continue
        if label['category'] not in CONFIRMED_CATEGORIES or label.get('confirmed_by') != 'user':
            raise ValueError('Explicit user label required')
        result.update(proposed_category=category, category=label['category'], confirmed_category=label['category'],
                      review_status='user_confirmed', confidence='사용자 확정')
        if 'role' in label:
            if label['role'] not in CONFIRMED_ROLES: raise ValueError('Explicit role value required')
            result.update(proposed_role=role, role=label['role'], confirmed_role=label['role'])
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


def merge_outbox(batch, path):
    """Combine approved local sources in memory; never stage or edit the queue."""
    scope = digest(batch['scope_key'])
    start, end = date(batch['start']), date(batch['end'])
    records = {}
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True)) as connection:
        connection.execute('BEGIN')
        state = connection.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?', (scope,)).fetchone()
        if not state: raise ValueError('Matching captured mailbox required')
        old_start, old_end = map(date, state)
        for payload, hashed in connection.execute('SELECT payload,payload_hash FROM mail_outbox WHERE scope_key=?', (scope,)):
            if hashlib.sha256(payload.encode('utf-8')).hexdigest() != hashed: raise ValueError('Stored original hash mismatch')
            mail = valid_mail(json.loads(payload), old_start, old_end)
            if mail['direction'] == 'received': records[mail['source_key']] = mail
    for value in batch['records']:
        mail = valid_mail(value, start, end)
        if mail['direction'] != 'received': raise ValueError('Received-only review required')
        old = records.get(mail['source_key'])
        if old is not None and canonical(old) != canonical(mail): raise ValueError('Conflicting original content')
        records[mail['source_key']] = mail
    return batch | dict(start=min(start, old_start).isoformat(), end=max(end, old_end).isoformat(),
                        records=list(records.values()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--outbox', type=Path, help='Read-only approved local queue; combine received originals in memory')
    args = parser.parse_args()
    batch = json.loads(args.capture.read_text(encoding='utf-8-sig'))
    if args.outbox: batch = merge_outbox(batch, args.outbox)
    settings = json.loads(args.settings.read_text(encoding='utf-8-sig'))
    result = report(batch, settings)
    # Exclusive creation: earlier review and corrections must never be overwritten.
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: result[key] for key in ['reviewed_candidates', 'counts', 'external_ai_calls', 'server_uploads', 'crm_changes']}, ensure_ascii=False))


if __name__ == '__main__': main()

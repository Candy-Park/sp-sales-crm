"""Read-only local workflow hints, never a gold label, task, reply or state mutation."""
import hashlib
import json
import re
import sqlite3
import sys
import uuid
from contextlib import closing
from pathlib import Path
from datetime import timedelta,timezone
from outlook_outbox import date, digest, valid_mail
from outlook_review import newest_text

VERSION='workflow-rules:v3'
NON_BUSINESS={'스팸','광고','뉴스레터','업무 알림','보안 알림','업무 제외'}

def propose(mail, context, category):
    result=dict(version=VERSION, proposed=True, auto_apply=False, work_kind='업무 목적 확인',
                stage='판단 보류', waiting_on='관계·내용 확인 필요', next_action='최신 원문과 질문을 검토한 뒤 문의 또는 Action에 기록',
                evidence=[], caveats=['로컬 규칙의 검토 제안이며 사용자 확정·현재 문의 상태가 아닙니다.',
                    '승인된 수집 범위만 비교했습니다. 다른 대화·전화·회의 처리는 확인하지 않았습니다.'],
                thread_count=1, later_sent=0, later_received=0, observed_at=mail['occurred_at'])
    if len(mail['body'])>100000:
        result.update(stage='긴 본문 보류',next_action='이 PC에 보존한 전체 원문을 직접 검토; 문의 연결 보류')
        return result
    if category in NON_BUSINESS:
        result.update(stage='별도 검토',next_action='알림·스팸 분류와 업무 필요 여부를 검토; 문의 자동 생성 없음')
        return result
    top=newest_text(mail['body'])
    # Avoid signature phrases and never export matched excerpts, contacts or amounts.
    top=re.split(r'(?im)^\s*(?:best regards|regards|sincerely|감사합니다)\b',top)[0]
    if len(top)<len(mail['body']):result['evidence'].append('최신 본문을 이전 인용문·서명과 구분')
    kinds=[('청구·정산',r'\binvoice\b|\breimburse\w*\b|인보이스|청구|정산'),
           ('납기 확인',r'\blead\s*time\b|납기|交期'),('재고 확인',r'\bstock\b|재고|庫存|库存'),
           ('가격 확인',r'\bpric\w*\b|견적|가격|價格|价格|報價|报价'),('사양 확인',r'\bspec\w*\b|사양|규격|規格|规格')]
    for kind,pattern in kinds:
        if re.search(pattern,top,re.I):result['work_kind']=kind;result['evidence'].append('최신 본문의 '+kind+' 표현');break
    partial=bool(re.search(r'\b(?:need\w* to confirm|will (?:check|confirm|update)|await\w*|pending|not yet)\b|확인\s*(?:중|후)|확인해\s*(?:보|주)|추후|미확정|待確認|待确认|確認中|确认中|稍後|稍后|尚未|需要確認|需要确认',top,re.I))
    negative=bool(re.search(r'\b(?:not|no|without|unavailable|cannot|can.t)\b|불가|없[습음는]|미승인|無法|无法|沒有|没有|不能|暫無|暂无',top,re.I))
    request=bool(re.search(r'\b(?:please|request|could you|would you|can you)\b|부탁|요청|문의|請|请|麻煩|麻烦|詢問|询问|需求|協助|协助',top,re.I))
    stock_answer=result['work_kind']=='재고 확인' and bool(re.search(r'\bin stock\b|재고\s*(?:있|보유)',top,re.I))
    shipment=re.search(r'\bwill\s+(?:arrange\s+(?:the\s+)?(?:shipping|shipment)(?:\s+of)?|ship)\s+(\d{1,5})\s*(?:pcs|pieces)\b[^\n.]{0,120}\b(today|tomorrow)\b',top,re.I)
    if partial:
        result.update(stage='중간 답변 후보',waiting_on='HQ 확인 필요' if category=='HQ 업무' else '후속 답변 확인 필요',
                      next_action='미답변 질문과 확정되지 않은 조건을 기록하고 추가 답변 확인')
    elif negative and (stock_answer or not request):
        result.update(stage='추가 확인 후보',next_action='부정·제약 조건과 대안을 검토; 긍정 답변으로 확정하지 않음')
    elif request:
        result.update(stage='요청 후보',waiting_on='담당자 확인 필요',next_action='요청 조건을 확인해 기존 문의 또는 신규 문의에 연결하고 필요한 Action 등록')
    elif stock_answer:
        result.update(stage='답변 후보',waiting_on='답변 충분성 확인 필요',next_action='질문별 답변 범위와 수량·조건을 검토한 뒤 고객 회신 여부 확인')
    else:
        result['evidence'].append('요청·답변 충분성은 규칙만으로 확정할 수 없음')
    if shipment and not (partial or negative or request) and int(shipment[1])>0:
        planned=date(mail['occurred_at']).astimezone(timezone(timedelta(hours=9))).date()+timedelta(days=shipment[2].lower()=='tomorrow')
        result.update(work_kind='출하 일정',stage='출하 예정 답변 후보',waiting_on='실제 출하·송장 확인 필요',
                      shipping_plan=dict(date=planned.isoformat(),quantity=int(shipment[1]),actual_shipped=False),
                      next_action=f"{planned.isoformat()} {int(shipment[1])}개 출하 예정 — 실제 출하와 송장 확인")
        result['evidence'].append('최신 본문의 출하 예정 수량·상대 날짜를 서울 수신일 기준으로 해석')
        result['caveats'].append('출하 예정 답변은 실제 출하·고객 수령 완료나 기존 기한 변경이 아닙니다.')
    if negative:result['evidence'].append('최신 본문의 부정·제약 표현도 함께 검토 필요')
    if result['work_kind']=='청구·정산':result['caveats'].append('메일 발송·첨부 존재만으로 접수·승인·지급을 판정하지 않습니다.')
    if result['work_kind']=='재고 확인':result['caveats'].append('재고 답변과 실제 발주·출하·배송 완료를 구분합니다.')
    conversation=mail.get('conversation_key')
    thread=[m for m in context if conversation and m.get('conversation_key')==conversation] if conversation else [mail]
    thread={m['source_key']:m for m in thread};thread[mail['source_key']]=mail
    later=[m for m in thread.values() if date(m['occurred_at'])>date(mail['occurred_at'])]
    result.update(thread_count=len(thread),later_sent=sum(m['direction']=='sent' for m in later),
                  later_received=sum(m['direction']=='received' for m in later))
    result['observed_at']=max((m['occurred_at'] for m in thread.values()),key=date)
    if result['later_sent']:
        result['evidence'].append('동일 대화에서 이후 보낸 메일 기록 확인')
        result['next_action']='이후 보낸 메일의 수신 상대·내용·질문 대응 여부를 확인한 뒤 회신 기록 또는 Action 반영'
    if result['later_received']:
        result.update(stage='이후 수신 재검토 필요',next_action='동일 대화의 이후 수신부터 검토하고 현재 대기 대상과 미답변 질문 확인')
    if not conversation:result['caveats'].append('대화 식별자가 없어 다른 메일과 합치지 않았습니다.')
    return result

def read_workflow(path, owner, identity, category):
    uuid.UUID(owner);uuid.UUID(identity['id'])
    for field in ['scope_key','source_key','payload_hash']:digest(identity[field])
    with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as connection:
        connection.execute('BEGIN')
        bound=connection.execute("SELECT value FROM agent_binding WHERE key='owner'").fetchone()
        if not bound or bound[0]!=owner:raise ValueError('Owner mismatch')
        scope=identity['scope_key']
        window=connection.execute('SELECT window_start,window_end FROM capture_state WHERE scope_key=?',(scope,)).fetchone()
        if not window:raise ValueError('Captured scope missing')
        def decode(row):
            key,ident,payload,hashed,receipt=row
            if hashlib.sha256(payload.encode('utf-8')).hexdigest()!=hashed:raise ValueError('Original hash mismatch')
            saved=json.loads(receipt) if receipt else None
            if not isinstance(saved,dict) or set(saved)!={'id','source_key','payload_hash'} or saved['source_key']!=key or saved['payload_hash']!=hashed:raise ValueError('Receipt mismatch')
            uuid.UUID(saved['id'])
            value=valid_mail(json.loads(payload),date(window[0]),date(window[1]))
            if value['source_key']!=key:raise ValueError('Source mismatch')
            return value
        row=connection.execute('SELECT source_key,id,payload,payload_hash,receipt FROM mail_outbox WHERE scope_key=? AND source_key=?',(scope,identity['source_key'])).fetchone()
        expected={k:identity[k] for k in ['id','source_key','payload_hash']}
        if not row or row[3]!=identity['payload_hash'] or not row[4] or json.loads(row[4])!=expected:raise ValueError('Server identity mismatch')
        mail=decode(row)
        context=[mail]
        if mail['conversation_key'] and len(mail['body'])<=100000:
            rows=connection.execute("SELECT source_key,id,payload,payload_hash,receipt FROM mail_outbox WHERE scope_key=? AND receipt IS NOT NULL AND json_extract(payload,'$.conversation_key')=? LIMIT 1001",(scope,mail['conversation_key'])).fetchall()
            if len(rows)>1000:raise ValueError('Context limit exceeded')
            context=[decode(r) for r in rows]
        return propose(mail,context,category)

if __name__=='__main__':
    try:
        config=json.loads(sys.stdin.read(12000))
        if set(config)!={'owner','identity','category'}:raise ValueError('Unexpected input')
        result=read_workflow(Path('D:/AI/projects/sp-sales-crm/sources/outlook/outbox.sqlite'),**config)
        print(json.dumps(result,ensure_ascii=False))
    except Exception:
        sys.exit(1)  # No source, body, address or subprocess error in logs.

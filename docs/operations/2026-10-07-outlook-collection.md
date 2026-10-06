# Classic Outlook 수집·로컬 재개 기반 작업 기록

2026-10-07. 승인된 수집 연결 단계의 첫 구현 단위다. 시작 커밋 403b247, 로컬 codex/login-access/원격 없음. 실제 제품·회신 E2E를 완료한 뒤 진행했다. 이 기록은 서버 수집 연결이나 전체 Agent 완료를 뜻하지 않는다.

## 변경 목적·파일·보존

- tools/outlook_capture.ps1: 특정 Classic Outlook 사서함의 기본 받은/보낸 편지함만 읽는다. 수신은 ReceivedTime, 발송은 SentOn을 시작 포함/종료 제외의 분 단위 기간으로 제한한다. 기본 Preview는 건수·해시·식별 품질만 출력하고 Capture는 원문과 첨부 메타데이터를 지정 D 로컬 sources에 저장한다.
- tools/outlook_outbox.py: 별도 SQLite 원문/식별자/서버 영수증 큐. 배치 전체 원자적 저장, 동일 원문 중복 방지, 원문 충돌 시 배치 전체 거부, 동일 요청 식별자로 재시도, 정확한 서버 영수증 이후에만 pending 해제, 소유자 바인딩, 인증/제약 오류 중단, 일시 오류 최대 3회, 성공 확인 시각과 로컬 수집 시각 구분.
- tests/test_outlook_outbox.py: 합성 메일의 실제 SQLite 재시작·충돌·영수증과 PowerShell 식별/기간 검증. 기존 synthetic-only sync_receipt_probe.py와 기본 CRM 코드를 보존했다.
- 기존 메일 변경·발송·이동·삭제·읽음 상태 설정·첨부 다운로드·Outlook Quit 없음. PC CRM/sp-crm/무료 플랜/전역 지침/활성 개발 경로 유지. 웹/API/회신 DB 권한은 변경하지 않았다.

## 실제 수집과 재개 확인

- 특정 기본 사서함의 읽기 연결을 확인했다. 정확한 기간은 서울 2026-09-07 01:27:00 이상, 2026-10-07 01:27:00 미만이다. 최근 1개월의 실행 시점 스냅샷이며 모든 과거 메일 수집이 아니다.
- 받은 291건, 보낸 47건 = 338건. 비메일 2건 제외. 인터넷 메시지 식별자 없는 항목 0, 각 방향의 source key 중복 0. 실제 ID/주소/제목/본문을 로그에 출력하지 않았다.
- 원문과 첨부 메타데이터만 D:/AI/projects/sp-sales-crm/sources/outlook/의 새 capture JSON 및 outbox.sqlite에 보존했다. 구체적인 개인 파일 위치는 ignored notes에 기록했다. sources 원문과 notes는 Git archive/커밋에 포함하지 않는다.
- 로컬 최초 저장 338, 같은 배치 재시도 신규 0/중복 338. 다른 프로세스에서 Outlook 같은 기간을 실제로 다시 수집하고 큐를 다시 열어도 신규 0/중복 338, 원문과 요청 식별자 변화 없음. 실제 서버 전송은 0이며 마지막 서버 성공 시각은 NULL이다.
- 초기 전체 배치 저장은 본문 크기 검사에서 실패했고 전체 트랜잭션을 롤백했다. 내용 대신 크기/자료형만 조사해 4건의 본문이 일반 회신 제한 100,000자를 초과함을 확인했다. 최대 2,974,731자. 메일 원문 수집 큐에 수동 회신 제한을 적용한 원인이다.
- 회귀 검사 실패를 먼저 재현한 뒤 로컬 원문 보존 상한을 10,000,000자로 분리했다. 원문을 잘라 저장하거나 큰 메일을 조용히 제외하지 않았다. 긴 본문의 CRM 저장 방식은 아래 사용자 선택 전까지 미정이다.

## 검증 근거·한계

- 신규 기반 부재 14개 실패 → 구현 통과. PowerShell 식별/기간 기능 부재 4개 실패 → 통과. 첨부만 있는 빈 원문 보존, 긴 원문 보존, bool 버전 거부의 실패 재현 → 보완.
- 최종 python -m unittest discover -s tests -p 'test_*.py' -v 30/30, npm test 58/58, npm run build, PowerShell Parser, git diff --check 통과.
- 공식 자료: [인터넷 Message-ID](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtaginternetmessageid-canonical-property), [기간 Restrict](https://learn.microsoft.com/en-us/office/vba/api/outlook.items.restrict), [EntryID](https://learn.microsoft.com/en-us/office/vba/api/outlook.mailitem.entryid). 인터넷 Message-ID를 사서함 범위/방향과 함께 해시해 사용한다. 없을 때만 EntryID fallback을 명시한다. 이동·재설치 후 EntryID 영속성을 보장하지 않는다. 원문이 다른 동일 ID는 합치지 않는다.
- 실제 메일 이동·답장·전달·서버 반영·네트워크 복구 E2E와 수집 대기/문의 연결 화면은 남아 있다. 이번에는 수집/로컬 재수집과 합성 delivery 어댑터만 검사했고 서버 영수증이나 자동 동기화 완료로 보고하지 않는다.
- 유실 응답/인증/내용 충돌/원문 보존 검사는 합성 transport를 사용했다. 백그라운드 실행·서비스 설치·인증 보관·자동 예약은 구현하거나 설정하지 않았다.

## 산출물·커밋·복원·다음 작업

D outputs에 outlook-capture-preview/local/replay.json, outlook-outbox-actual.json, outlook-recapture-result.json, RED/GREEN/전체 테스트 기록을 보관한다. 출력은 건수·상태·자료형·해시 중심이다. 문서 변경 전 사본은 outlook-records-before/에 보존했고 소스와 완료 기록은 최종 로컬 커밋과 연결한다. 원격 업로드·배포 없음.

코드/문서는 403b247과 파일별 비교해 필요한 범위만 복원할 수 있다. 로컬 원문/큐는 삭제하지 않고 sources에 보존한다. 기존 Outlook 원본을 수정하지 않아 원본 메일 복원은 필요 없다. 서버/기존 CRM의 외부 반영은 없음.

사용자 선택 대기: (1) 로그인한 CRM에서 직접 시작하여 검증할지, 별도 인증 보관이 필요한 PC 백그라운드 자동 수집까지 설정할지. (2) 큰 본문 4건을 로컬 원문 보존+CRM 보류로 두고 나머지부터 연결할지, 4건도 원문 전체를 새 Supabase에 저장하도록 구현할지. 선택 전 자격증명 보관이나 해당 메일의 CRM 반영 정책을 확정하지 않는다. 그 뒤 인증된 수집 API/소유자 RLS·대기 목록·신규/기존 문의 연결·실제 서버 재수집/복구를 구현한다. AI 서비스/비용, 두 세션 경합, 백업 복원 및 1주 실사용도 별도 남아 있다.

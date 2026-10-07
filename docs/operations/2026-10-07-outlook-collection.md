# Classic Outlook 수집·로컬 재개 기반 작업 기록

최신 확인: 사용자 Chrome 로그인 후 실제 서버 338건(일반 원문 334·보류 메타데이터 4), 로컬 영수증 338·미전송 0. 중단·결과 확인 유실·재시작·재수집과 원문 해시 대조 통과. 실메일 문의 연결은 사용자 대상 선택 대기이며 아래 초기 기록은 당시 상태를 보존한다.

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

2026-10-07 후속 결정: 로그인한 CRM에서 직접 시작하고 긴 본문 4건은 로컬 원문 보존+CRM 보류, 나머지 334건부터 연결하도록 사용자가 승인했다. 같은 선택을 다시 묻지 않는다. 아래 후속 구현은 f0d1777에서 시작하며 이전 검증은 당시 기록으로 보존한다.

## 후속 수집 연결 구현 — 2026-10-07

### 변경·보존·백업

시작 커밋 f0d1777aab8e670a0913dd878afdcabb20b5ca79, 브랜치 codex/login-access, 원격 없음. 승인 결정을 먼저 검토 기록과 기획서에 반영했다. 변경 전 지정 문서 사본은 D:/AI/projects/sp-sales-crm/outputs/outlook-connect-records-before/에 보관했다.

- src/outlook.mjs, src/api.mjs: 로그인 Auth 서버 확인과 sales_access 허용 계정 확인 후 수집·목록·원문·명시적 문의 연결 API를 제공한다. 클라이언트 소유자 지정은 거부하며 읽기는 검증한 owner_id로 제한한다. 목록은 본문 없이 50건씩 조회하고 상세에서만 원문을 읽는다.
- db/outlook-collection.sql: 새 sales_outlook_mail 테이블, 소유자 RLS·허용 계정, 본문/연결 불변 규칙, 일반 원문 UTF-8 SHA-256 검증, 소유자·사서함·메일 키 중복 영수증과 원문 충돌 거부, invoker RPC를 추가했다. 긴 본문은 body=null 메타데이터·원문 해시만 저장하며 held 상태로 연결을 차단한다. 신규 문의 생성과 메일 연결은 같은 DB 트랜잭션으로 처리한다. 연결한 보낸 메일만으로 발송 기록·문의 상태를 자동 변경하지 않는다.
- tools/outlook-local.mjs, tools/outlook_bridge.py, tools/outlook_collect_scope.ps1, tools/dev-server.mjs: CRM 직접 시작 작업과 인증된 상태 조회를 연결했다. 이전 승인 사서함의 해시와 고정 기간만 재수집하고 기존 outbox.sqlite에서 미전송을 재개한다. 토큰은 stdin/프로세스 메모리에서만 사용하고 argv·파일·로그에 남기지 않는다. 서비스 권한 키를 사용하지 않는다. 같은 실행 중 작업은 중복 시작하지 않으며 새 프로세스에서도 영수증을 확인한 메일부터 재개한다. 자동 예약·서비스 설치·백그라운드 자동 시작은 없다.
- web/outlook.mjs, web/index.html, web/workspace.mjs: 수집 상태·기간, 대기/보류/연결 목록, 원문, 신규/기존 문의 선택, 문의 상세의 연결 메일 이력을 추가했다. 제목만으로 자동 병합하거나 모든 메일로 문의를 생성하지 않는다. 늦은 조회 응답·로그아웃으로 이전 원문이 복원되지 않게 하고 불확실한 신규 연결 재시도에서 동일 요청 ID와 원문을 유지한다.
- tests/outlook.test.mjs, tests/outlook-ui.test.mjs, tests/test_outlook_bridge.py, db/test-outlook-collection.sql: 인증·소유자·보류·입력/첨부 메타데이터·중복/유실 응답·신규/기존 연결·종료 이력·UI 비동기 검사를 추가했다.

기존 PC CRM/sp-crm, 제품·회신 SQL과 동결 산출물, Outlook 원본 메일·첨부·폴더·읽음 상태, 활성 개발 경로·무료 플랜·원격/배포 조건을 보존했다. .env는 변경하지 않았다. 소스 Git에 메일 원문·인증정보를 추가하지 않았다.

### 실제 적용·검증과 발견한 수정

1. Chrome 기존 CRM 탭 로그인 상태를 확인했고 새로고침하지 않았다. 로컬 서버를 새 코드로 재시작했으며 브라우저 세션을 추출하거나 복사하지 않았다. 새 CRM 탭은 메모리 세션이 없어 사용자 직접 로그인이 필요하다.
2. Supabase 커넥터는 USER_NOT_LOGGED_IN으로 직접 조회가 막혀, 로그인된 Chrome의 glscckjmlwvxilzneqdf SQL Editor를 사용했다. 사전 조회에서 digest 스키마 extensions, 새 테이블 없음, 기존 허용 계정 1개를 확인한 뒤 수집 전용 SQL을 적용했다. 기존 제품/회신 SQL은 재실행하지 않았다. 수집 SQL 8,263자와 저장 파일 길이를 대조했고 Success를 확인했다.
3. SQL 편집기의 setValue가 전체 문서를 교체하지 않아 다음 검사에 기존 DDL이 남고 relation already exists로 실패했다. 원인을 확인해 문서 전체 선택/삭제/붙여넣기로 검사 SQL만 입력했다. 격리된 8,032자 test-outlook-collection.sql 실행 결과 outlook_rollback_passed / enabled_accounts=1 / remaining_fixtures=0 / remaining_test_users=0이다. 일반·보류 원문, 영수증 재전송, 바뀐 원문/해시 거부, 익명·미허용·다른 소유자 차단, 신규/기존 문의 연결·발송 자동 처리 없음, 종료 후 이력 보존을 실제 DB에서 검사했다. 합성 트랜잭션 ROLLBACK이며 실제 메일 전송 검증과 구분한다.
4. 로컬 338건 전체를 전송 입력 검증에 대조했다. 일반 334/보류 4, valid=338/invalid=0, 원문 SHA-256 모두 유지. 첫 임시 검사 도구의 UTF-8 스트림 청크별 문자열 변환으로 2건 길이 검사가 잘못 실패했으므로 Buffer.concat 후 한 번 디코딩하도록 검사 도구를 고쳤다. 실제 전송 코드는 바이트를 통째로 처리하며 원문은 변경하지 않았다.
5. 새 사서함 해시 기반 PowerShell 도우미의 실제 재수집을 실행했다. 첫 실행은 dot-source한 기존 스크립트가 동일 이름의 Start/End/OutputPath 변수를 덮는 문제로 실패했다. 도우미 변수명을 분리하고 별칭으로 기존 호출 인자를 유지했으며 회귀 검사를 추가했다. 수정 후 실제 338건, 신규 0/중복 338, 이전 요청 ID·원문 해시 유지, 서버 전송 0이다. 새 capture 경로는 ignored notes/outlook-crm-scope-check-location.json에만 기록했다.
6. 실제 로컬 API: 익명 목록/수집 시작 401, 잘못된 Origin 403, 무효 Bearer 401. 모두 메일 전송 없이 확인했다. 최종 Node 72개, Python 35개, 브라우저 빌드, PowerShell Parser, git diff --check 검증 결과는 아래 산출물에 보관한다.

### 현재 한계·다음 작업·커밋·복원

**이 구현 종료 시점의 실제 서버 반영·영수증은 0건이었다.** DB 적용·합성 검사는 실제 수집 완료가 아니다. 새 CRM 탭 사용자 직접 로그인 후 수집 버튼으로 일반 334건 원문/4건 보류 메타데이터를 실제 전송하고, 전체 서버 건수·보류 본문 null·로컬 영수증을 대조해야 하는 상태였다. 아래 실제 검증에서 해소된 항목과 남은 항목을 구분한다. 실메일 연결 대상은 자동 선택하지 않는다. 인증정보 영구 보관이나 세션 추출로 로그인 대기를 우회하지 않는다.

AI 서비스·모델·비용, 두 실제 세션 경합, 백업 복원 및 1주 실사용도 미완료다. 자동 발송·AI 호출·배포·원격 push는 하지 않았다. 최신 로컬 커밋은 Git 이력으로 연결한다. 소스/문서는 f0d1777과 해당 파일만 비교해 복원하며, 새 DB 외부 적용분과 원문 큐는 임의로 삭제하거나 되돌리지 않는다. 제품/회신 테이블·원문을 건드리는 복구를 수행하지 않는다.

산출물: D:/AI/projects/sp-sales-crm/outputs/2026-10-07-outlook-transport-audit.json, outlook-crm-scope-check.json, outlook-db-result.json, outlook-live-api-denials.json, outlook-connect-node-tests.txt, outlook-connect-python-tests.txt (뒤 파일도 모두 2026-10-07- 접두어). 개인 capture·본문·자격증명은 산출물이나 Git에 넣지 않았다.

## 사용자 Chrome 로그인 후 실제 서버 수집·재개 검증 — 2026-10-07

사용자가 Chrome에서 직접 로그인한 뒤 “완료”라고 알려줬다. 현재 메모리 세션을 사용하고 새로고침하거나 비밀번호·토큰을 추출/복사하지 않았다. 시작 커밋 `1387bae`, 로컬 브랜치 `codex/login-access`, 원격 없음. 이번 변경은 재사용 가능한 `db/verify-outlook-collection.sql`과 검증 기록이며 업무 구현/DB 구조를 다시 적용하지 않았다.

### 보존·실행

- 실행 전 SQLite backup API로 원문/큐의 일관된 사본을 D sources/outlook/backups/에 보존했다. 문서 사본은 D outputs/outlook-live-records-before/에 보관했다. 이 사본 작성만으로 백업 복원 검수 완료를 주장하지 않는다.
- 로그인한 CRM의 ‘승인 기간 직접 수집 · 미전송 재개’를 눌렀다. 동일한 사서함 해시·승인 기간(서울 2026-09-07 01:27 이상~2026-10-07 01:27 미만)만 읽었다. 원본 메일/폴더/첨부/읽음 상태, 기존 PC CRM/sp-crm, Auth·무료 플랜·.env는 변경하지 않았다.
- 받은 291건·보낸 47건의 원문은 로컬에 그대로 보존했다. 긴 본문 4건의 서버 데이터는 본문 null·원문 해시·길이와 메타데이터이며, 전체 본문은 보내지 않았다. 모든 메일을 문의로 자동 생성하거나 제목으로 합치지 않았다.

### 실제 검증 결과

1. 전송 중 Python bridge 프로세스를 의도적으로 중단했다. SQLite 영수증은 256건/미전송 82건, 실제 DB는 257건이었다. 서버 저장은 성공했지만 로컬 영수증을 확인하지 못한 1건을 실제로 만들었다. 큐 integrity는 ok이고 마지막 서버 성공 시각은 아직 없음이었다.
2. 같은 CRM 버튼으로 새 Python 프로세스에서 재개했다. 최종 서버 338건·로컬 영수증 338건·미전송 0건이다. 확인이 유실된 1건도 같은 ID/원문으로 재전송되어 중복 없이 영수증을 복구했다. 별도의 전체 네트워크 단절 시험과는 구분한다.
3. 읽기 전용 SQL: 일반 대기 334, 보류 4, 연결 0, 받은 291, 보낸 47. 보류 4건 모두 본문 null, 일반 334건 모두 길이 일치. 로컬/서버의 식별자·사서함·메일 키·원문 해시를 정렬 집계한 SHA-256과 본문 SHA-256 집계가 모두 일치한다. 원문 해시·요청 ID는 실행 전과 동일하며 모든 영수증의 ID/key/hash가 로컬 원문과 정확히 맞는다.
4. Node 로컬 서버를 재시작한 뒤 같은 Chrome 세션에서 상태를 조회했다. 저장된 영수증 338·미전송 0과 마지막 서버 성공 시각을 복원했다. 다시 CRM 버튼으로 실제 Outlook 재수집: 338건, 신규 0/중복 338, 원문 해시 모두 일치. 실제 DB의 최종 접근 검사에서도 338건으로 중복이 없음을 확인했다.
5. 실제 목록 첫 페이지 50건을 확인했다. 최대 본문 2,974,731자의 보류 메일 상세는 로컬 원문 보존·서버 미전송을 명시하고 연결 폼을 숨긴다. 사용자에게 실제 연결할 메일과 신규/기존 문의 및 신규 고객사 선택을 요청했다. 아직 실메일 문의 연결은 0건이다.
6. `db/verify-outlook-collection.sql`: 실제 소유자에게 338건 조회, 다른 미허용 인증 주체와 익명에게 조회/수집/연결 차단, RLS·invoker·원문 UPDATE/DELETE 금지 확인. 결과 `outlook_actual_access_passed`, 허용 계정 1, 모든 보안 확인 true. 역할/claim은 ROLLBACK하며 계정·원문·권한을 변경하지 않는다. 다른 허용 소유자의 격리·연결/종료 검사는 앞선 합성 ROLLBACK 결과와 구분한다.
7. 재시작한 실제 API에서 익명 목록/로컬 상태 401, 무효 Bearer 401, 다른 Origin 403. 마지막 Node 72개·Python 35개·브라우저 빌드 통과. 메일 본문·비밀번호·토큰은 로그/산출물/Git에 넣지 않았다.

### 산출물·커밋·남은 작업·복원

D outputs의 `2026-10-07-outlook-live-` 접두어로 before.json, stop.json, db-counts.txt, counts.sql, verified.json, recapture.json, access.txt, api-access.json, held-ui.json, status.jpg, node-tests.txt, python-tests.txt를 보관했다. 결과는 건수·검증용 해시·보류 안내 중심이며 status 이미지는 메일 목록/본문을 제외했다. 개인 capture 위치는 Git에 포함하지 않는다.

관련 SQL·보고서·작업 기록만 로컬 커밋한다. 원격·push·배포 없음. 기획서의 확정 요구사항은 바뀌지 않았다. 공유 기술 파일은 `1387bae`와 파일별 비교하여 복원한다. 서버의 실제 338건과 로컬 원문/영수증은 임의 삭제하거나 백업으로 덮어쓰지 않는다.

실제 수집 전송·중단 후 재개·1건 결과 확인 유실·서버 재시작·재수집·접근통제는 확인했다. **실메일의 신규/기존 문의 연결은 사용자 대상 선택 대기**다. 원문 메일을 이동/발송하지 않았으므로 실제 폴더 이동·답장·전달도 미검증이다. AI 서비스·모델·비용, 두 실제 세션 경합, 백업 복원 및 1주 실사용은 계속 미완료이며 전체 MVP 완료를 주장하지 않는다.

## 수동 업무 제외·복원 — 2026-10-07

### 목적·변경·보존

사용자의 다음 작업 진행 요청에 따라 광고·알림을 직접 검토해 업무 목록에서 제외하고 복원하는 기능을 추가했다. 시작 커밋 `016f980`, `codex/login-access`, 원격 없음. 변경 전 소스/문서 사본은 D outputs/2026-10-07-triage-before/에 보관했다.

- `src/outlook.mjs`, `src/api.mjs`: 명시적 제외 여부와 검토 버전만 받는 인증된 triage API. 검증한 소유자·허용 계정을 사용하고 업무/제외/전체 목록을 서버에서 필터한다. 목록은 본문 없이 50건씩 조회한다.
- `db/outlook-triage.sql`: 제외 flag와 별도 검토 버전을 추가하는 증분 SQL. 기존 owner RLS·영수증·수집/연결 RPC는 유지한다. invoker triage RPC에서 행 잠금·버전 충돌을 검사한다. 같은 결과 재시도는 멱등이며 이후 복원을 이전 제외 요청이 덮지 못한다. 컬럼 권한은 제외 flag/버전에만 추가하고 원문 변경·삭제를 계속 차단한다. 트리거는 문의 연결된 메일의 제외와 제외된 메일의 연결을 막는다. 잘못된 신규 문의 연결 시 생성까지 같은 트랜잭션에서 롤백한다.
- `web/index.html`, `web/outlook.mjs`: 기본 업무/업무 제외/전체 목록, 상세 제외·복원, 원문·영수증 보존 안내. 긴 본문은 제외/복원 후에도 held·본문 로컬 보존·연결 차단을 유지한다. 필터 변경/로그아웃 후 지연 응답이 이전 상세 원문을 복원하거나 이전 연결 화면을 열지 못하게 했다. 결과 확인 실패 시 입력·검토 버전·원문은 유지한다.
- `tests/outlook.test.mjs`, `tests/outlook-ui.test.mjs`, `db/test-outlook-triage.sql`: 입력 위조·인증·필터·페이지·버전 충돌·비동기 UI와 실제 DB 합성 ROLLBACK 검사.

실제 메일은 자동 분류/제외하지 않았다. 받은/보낸 편지함만 수집하며 정크 폴더는 포함하지 않는다. 기존 실제 338건, 로컬 원문/큐, 제품·회신 SQL과 동결 산출물, 기존 PC CRM/sp-crm, .env와 Auth, SP 색상·로고, 무료 플랜·활성 경로를 보존했다. AI 호출·자동 발송·인증정보 영구 보관·백그라운드 자동 실행을 추가하지 않았다.

### 실제 DB·화면·전체 검증

1. 새 프로젝트 glscckjmlwvxilzneqdf의 로그인된 Chrome SQL Editor에서 사전 조회: triage 컬럼 0, 기존 실제 338건/일반 334/held 4/linked 0. 증분 SQL만 한 번 적용해 Success를 확인했다. 기존 제품/회신/수집 DDL을 재실행하지 않았다.
2. 실제 DB `test-outlook-triage.sql`: `outlook_triage_rollback_passed`, real_total=338, remaining_fixtures=0, remaining_test_users=0, invoker=true. 제외·동일 요청 재시도·재수집 시 제외/영수증 유지·복원·늦은 제외 재시도 충돌·원문 불변·held 유지·연결 제한·잘못된 신규 문의의 롤백·직접 버전 위조·원문 UPDATE 권한 차단·다른 허용 소유자/미허용/익명 차단을 확인했다. 전부 합성 메일과 임시 계정이며 실제 사용자 세션 경합 검수와 구분한다.
3. 기존 `test-outlook-collection.sql`의 검사만 재실행해 `outlook_rollback_passed`, enabled_accounts=1, remaining_fixtures=0, remaining_test_users=0을 확인했다. 수집·영수증·신규/기존 연결·Closed 이력 회귀 통과.
4. 사후 실제 338건, 제외 0, 변경된 검토 버전 0, 일반 334, held 4. 식별/원문 집계 SHA-256은 적용 전후 동일하다. held 4건 본문 null·일반 334건 길이도 유지됐다. 메일 주소·제목·본문을 출력하지 않았다.
5. 별도 Chrome의 네트워크 없는 합성 fixture: 광고 제외 → 기본 목록에서 숨김 → 제외 목록에서 원문 유지/연결 폼 숨김 → 복원 → 제외 목록에서 사라짐. held 제외/복원 후 최대 길이 안내·연결 차단 유지, 연결된 메일 제외 버튼 숨김. fixture는 ignored notes에 두고 D outputs/2026-10-07-triage-ui/에만 빌드·합성 결과를 저장했다. 동결된 ui-fixture 산출물은 재생성하지 않았다.
6. 실제 로컬 서버 프로세스/명령을 확인한 뒤 새 API 코드로 재시작했다. 기존 사용자 Chrome 로그인 탭은 새로고침하지 않았다. 새 실제 Chrome 탭에는 메모리 세션이 없어 사용자 직접 로그인을 요청했다. 토큰·비밀번호 추출/복사·저장으로 우회하지 않았다. 새로운 실제 화면에서 실메일 제외·복원 E2E는 로그인/대상 선택 전까지 미완료다.
7. API 검사의 기능 부재 3개 실패를 먼저 재현한 뒤 수정했다. 최종 Node 81/81, Python 35/35, npm run build, git diff --check 통과. 필터 변경 중 지연된 연결 응답/사후 재조회도 이전 원문을 열지 않는 회귀 검사 포함.
8. 재시작한 실제 triage API: 익명 401, 무효 Bearer 401, 다른 Origin 403을 확인했다. 토큰·원문을 출력하지 않았으며 실제 메일 flag 변경도 없다.

### 산출물·커밋·복원·다음 작업

D outputs/2026-10-07-outlook-triage- 접두어에 red.txt, db-before.txt, db-test.txt, regression-db.txt, db-after.txt, db-proof.jpg, ui-proof.jpg, node-tests.txt, python-tests.txt, api-access.json을 보관한다. DB 결과는 건수·검증용 집계 해시만, UI 이미지는 가상 메일만 포함한다. 실제 본문·인증정보·개인 경로 목록을 Git에 넣지 않았다. 관련 소스/SQL/검사/문서만 이 기록과 함께 로컬 커밋하며 커밋 ID는 Git 이력으로 연결한다. 원격·push·배포 없음.

코드/문서는 `016f980`과 파일별 비교하여 필요한 변경만 복원할 수 있다. 실제 DB 증분 변경은 임의로 되돌리지 않는다. 복구 시 원문/영수증을 보존하고 해당 함수와 UI 변경만 검토해야 하며 이전 DDL 전체를 실행하거나 338건을 삭제/백업으로 덮어쓰지 않는다.

다음: 새 실제 Chrome 화면 로그인과 사용자가 선택한 메일의 제외·복원/신규·기존 문의 연결 검증. AI 서비스·모델·비용은 계속 미결정이고 호출 0이다. 두 실제 세션 경합, 실제 폴더 이동·답장·전달, 백업 복원, 1주 실사용은 남아 있다.

### Chrome 재로그인 후 실제 목록 확인 — 2026-10-07

사용자가 Chrome에서 직접 재로그인했다고 알려줬다. `7e5f292` 이후 기존 사용자 Chrome 탭에서 로그인과 새 업무/제외/전체 필터가 함께 존재함을 확인했다. 추가 새로고침이나 인증정보 추출 없이 실제 메뉴를 조회했다. 업무/전체 첫 페이지 50건, 업무 제외 목록 0건·빈 목록 안내, 로컬/영수증 338·미전송 0·보류 4와 마지막 성공 시각을 확인했다. 기본 업무 목록으로 돌려두고 제가 열었던 중복 로그인 탭은 닫았다. 사용자의 기존 로그인 탭은 유지했다.

실제 메일 본문·제목·주소를 출력하지 않았고 제외·복원 쓰기나 수집을 추가 실행하지 않았다. 비공개 목록을 제외한 화면 영역 캡처는 브라우저 캡처 시간 초과로 저장하지 못했으며 DOM의 실제 상태로 확인했다. 문서만 갱신하고 `git diff --check` 후 관련 기록을 로컬 커밋한다. 이전 검사는 재실행하지 않았다. 이 기록은 `7e5f292`와 파일별 비교해 복원 가능하며 외부 DB 변경 없음. 남은 실제 메일 제외·복원/문의 연결은 사용자 대상 선택이 필요하다. 재로그인 자체를 전체 E2E 완료로 보고하지 않는다.

## 로컬 큐 백업·복원 검증 및 실제 메일 후보 준비 — 2026-10-07

사용자가 계속 진행을 요청했다. 실메일 대상 선정을 사용자에게 모두 맡기지 말아 달라는 의견을 받아 최근 목록의 제목·수신 시각만으로 제외/복원용 광고 후보 1건과 신규 문의 연결용 업무 후보 1건을 제시했다. 본문은 도구 출력·로그·Git에 남기지 않았으며 고객사명 확인 전 실제 메일 제외/복원이나 고객/문의 생성은 하지 않는다. 업무 메일 상세를 Chrome에 열어두었다. 개인 후보의 정확한 제목·시각은 공유 문서에 기록하지 않는다.

### 변경·실행·보존

시작 커밋 `acfc2ac`, 브랜치 `codex/login-access`, 원격 없음. `tools/outlook_restore_verify.py`는 현재 큐를 읽기 전용으로 열고 SQLite backup API로 일관된 백업을 만든다. 백업과 복원 경로는 기존 파일·원본과 구분된 새 경로만 허용하며 덮어쓰지 않는다. `tests/test_outlook_restore_verify.py`는 합성 원문/미전송/영수증의 복원, 기존 파일 보존, 원문 해시/영수증 손상 검출과 로그의 원문 미노출을 검사한다.

실제 원문/영수증을 담은 백업은 D sources/outlook/backups/outbox-restore-check-20261007.sqlite, 검증용 복원 사본은 D scratch/outlook-restore-check-20261007/outbox.sqlite에만 저장했다. 공유 산출물은 D outputs/2026-10-07-outlook-local-restore.json의 건수·집계 해시·검증 결과다. 네트워크/Outlook 수집/발송과 실제 서버 변경은 하지 않았고 .env/Auth/기존 CRM/sp-crm/동결 산출물을 보존했다.

검증 명령은 프로젝트 경로에서 `python -m tools.outlook_restore_verify --source <live.sqlite> --backup <new-backup.sqlite> --restore <new-isolated.sqlite> --report <new-result.json>`이다. 실제 원문을 포함하는 backup/restore는 sources와 scratch에 두며 outputs/Git에 넣지 않는다. 기존 파일 경로를 재사용하지 않는다. 운영 원본에 복원 사본을 덮는 명령은 제공하지 않는다.

### 검증 결과·한계·복원

- 실제 `local_outbox_restore_passed`: 총 338·영수증 338·미전송 0·held 4·받은 291·보낸 47. 백업→복원 직후 원문/영수증/수집 상태/바인딩 집계 해시가 모두 일치했고, 기존 소유자로 다시 열어도 동일했다. 다른 소유자 바인딩은 거부했다.
- 격리 복원 사본에서 저장된 원문 338건으로 재등록: 신규 0/중복 338, 원문·기존 ID·영수증·소유자 바인딩 유지. 복원 사본의 재수집 시각만 갱신됐고 다시 프로세스를 열어도 이후 상태가 유지됐다. 실제 Outlook 재수집/서버 업로드와 구분한다. 네트워크 호출 0, 현재 live 큐의 원문/영수증/상태/바인딩은 변경 없음.
- 첫 합성 검사 1건은 테스트 코드의 SQLite 컨텍스트가 연결을 닫지 않아 Windows 임시 파일 정리에서 실패했다. 연결을 명시적으로 닫도록 고쳐 4개 복원 검사와 전체 Python 39/39, Node 81/81, git diff --check 통과. 브라우저 소스는 바뀌지 않아 빌드를 반복하지 않았다. 기록은 D outputs/2026-10-07-outlook-restore-python-tests.txt 및 node-tests.txt에 보관한다.
- 소스/문서와 검사만 선별 로컬 커밋하고 커밋 ID는 Git 이력으로 연결한다. 원격·push·배포 없음. 해당 변경은 `acfc2ac`와 파일별 비교해 복원할 수 있다. 현재 운영 큐와 서버 데이터는 덮어쓰거나 삭제하지 않는다. 검증용 대용량 사본은 위 D 경로에 유지했다.

이 검증은 Outlook 로컬 outbox만 대상으로 한다. Supabase 전체 DB의 고객·문의·메시지·Action·제품 후보 관계 복원 검수와 정기 백업 주기/보관 기간/복구 목표는 남아 있다. 로컬에 psql/pg_dump/pg_restore/postgres 명령은 없어 서버 복원 도구나 환경을 임의 설치하지 않았다. 실제 메일 후보의 고객사 확인·제외/복원·문의 연결, 두 실제 세션 경합과 1주 실사용도 미완료다. AI 서비스·모델·비용은 미결정이며 호출하지 않는다.

## 사용자 확인 후 실메일 신규 문의 연결·제외/복원 검증 — 2026-10-07

사용자가 업무 메일의 회사 약어가 같은 업체임을 확인하고, 기존 개인 폴더와 일치하는 짧은 고객명으로 기록하라고 지정했다. 확인된 고객명·약어 관계는 실제 고객 데이터와 ignored notes/confirmed-customer-aliases.json에 남기며 공유 Git 기록에 개인 메일 제목·고객명·주소·본문을 넣지 않는다. 시작 커밋 `8939300`, 로컬 브랜치 `codex/login-access`, 원격 없음.

### 실행·검증·보존

1. 로그인된 기존 Chrome 세션에서 선택한 업무 메일의 신규 문의 연결을 실행했다. 고객 1개·문의 1개·메일 연결 1개를 생성하고 고객사 필터로 저장된 문의 1건을 재조회했다. 문의는 new·email이고 접수 시각은 원본 수신 시각이다. 보낸 기록/Action 생성은 각각 0이다. 실제 업무 문의를 테스트 완료라는 이유로 종료하거나 삭제하지 않았다.
2. 읽기 전용 DB 대조: 고객명 일치, 고객/문의/메일 소유자 일치, 신규 상태/이메일 채널, 문의 original_text와 메일 body의 정확한 일치, 접수 시각 일치, 연결 1개·고객 중복 없음. 메일 payload SHA-256·본문 SHA-256은 연결 전과 동일하다. 연결된 메일 상세는 새 연결 폼과 업무 제외 버튼을 숨기고 연결 문의를 열 수 있다.
3. 광고 검증 메일: 기본 목록에서 직접 제외 → 제외 목록 1건·복원 버튼·문의 연결 폼 숨김 → 같은 승인 사서함/기간을 실제 Outlook에서 재수집 → 제외 true/검토 버전 2와 원문 해시 유지 → 복원 → 제외 목록 0건. 최종 원문과 영수증은 보존하며 해당 검토 버전은 3이다. 광고를 영구 제외하거나 여러 메일을 자동 분류하지 않았다.
4. 실제 재수집: 로컬 338·영수증 338·미전송 0·held 4, 신규 0/중복 338. 새 capture의 모든 원문을 현재 SQLite와 비교하여 이전 ID·원문/영수증 해시 정확한 일치를 확인했다. SQLite integrity=ok. 구체적인 capture 위치는 ignored notes/outlook-live-link-recapture-location.json에만 보관했다. 이미 영수증이 있는 메일을 다시 서버 전송한 시험과는 구분하며, 제외된 메일의 ingest RPC 중복 보존은 앞선 실제 DB 합성 ROLLBACK 검사를 따른다.
5. 최종 서버 전체 338, 검토 대기 333, 연결 1, held 4, 제외 0, 받은 291/보낸 47. held 4건 body=null, 일반 334건 길이 일치. 전체 식별/원문 집계 SHA-256은 이전과 동일하다. `verify-outlook-collection.sql` 재검증: `outlook_actual_access_passed`, total=338, enabled_accounts=1, RLS/invoker/원문 변경·삭제 차단 모두 true. 역할/claim만 ROLLBACK하며 기존 DDL은 재실행하지 않았다.
6. 화면 상세 조회 초기에 비동기 응답을 기다리지 못해 제외 버튼을 찾지 못했다. 현재 상태 확인 후 목록 영역의 대상 버튼을 지정하고 상세 표시를 기다려 진행했다. 화면 증빙은 원문 영역을 제외한 상단만 저장했다. offset 영역 캡처 시간 초과를 확인하고 현재 화면 상단부터 캡처하는 방식으로 저장·눈으로 검수했다. 실제 본문/토큰/비밀번호는 도구 출력·산출물·Git에 기록하지 않았다.

### 산출물·기록·복원·남은 작업

D outputs의 2026-10-07-outlook-live-link- 접두어에 before.txt, after.txt, restored.txt, final-counts.txt, recapture.json, access.txt를 보관한다. 추가 검증 결과는 outlook-live-excluded.txt, outlook-live-excluded-recapture.txt, outlook-live-inquiry-check.txt와 dasan-inquiry-proof.jpg(모두 2026-10-07 접두어)다. 조회 결과는 건수·상태·검증용 해시/boolean만 포함한다. SQL의 구체적 메일 선택 조건과 도구는 ignored notes에만 둔다. 사용자 확인 고객명은 일반 업무 데이터이며 화면 증빙에 표시된다.

문서 사본은 D outputs/2026-10-07-outlook-live-link-records-before/에 보존했다. 이번 소스/DB 구조 변경은 없으며 이전 Node 81·Python 39 검사와 빌드 결과를 재실행 결과로 주장하지 않는다. 새 검증은 위 실제 Chrome/DB/Outlook 재수집 대조와 git diff --check다. 개발 보고서·이 기록만 선별 로컬 커밋하며 커밋 ID는 Git 이력으로 연결한다. 원격·push·배포 없음. 문서는 `8939300`과 파일별 비교해 복원할 수 있다. 실제 고객/문의/메일 연결과 기존 원문·큐를 임의 삭제하거나 이전 백업으로 덮지 않는다.

검증한 광고 메일은 복원했으며 실제 업무 문의는 신규 상태로 보존했다. 다음은 실제 업무 진행과 다른 실메일의 기존 문의 연결, AI 서비스·모델·비용 결정, 두 실제 세션 경합, Supabase 전체 DB 복원과 1주 실사용이다. 기존 PC CRM/sp-crm·무료 플랜·Auth·활성 경로·제품/회신 SQL과 동결 산출물을 유지했다. AI 호출·자동 발송·백그라운드 자동 실행·인증정보 영구 보관을 추가하지 않았다.

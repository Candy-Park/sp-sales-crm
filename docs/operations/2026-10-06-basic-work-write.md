# 기본 업무 등록·Action·Closed 구현 기록

개발계획서 2단계의 승인된 하위 작업. 시작 커밋 `007e743c6d08faf7418d13fef1d7de14f8e431dd`, 브랜치 `codex/login-access`, 미커밋 변경 없음, 원격 없음을 확인했다. 프로젝트 폴더의 AGENTS.md는 없었고 부모 candy_workspace/AGENTS.md와 사용자 공통 지침을 읽었다. 부모 하네스는 수정하지 않았다.

## 변경 목적·파일

- src/api.mjs, src/write-input.mjs: 매 요청 실제 Auth/허용목록 확인 후 소유자 조회와 입력 검증, 업무 RPC 호출. 클라이언트 owner_id와 알려지지 않은 필드를 거부한다. 저장 충돌 409, 업무 규칙/연결 오류 422, 권한 부족 403, 연결/불확실한 저장 결과 503을 구분한다. 백엔드 내부 오류를 그대로 내보내지 않는다.
- db/basic-work-write.sql: SECURITY INVOKER 함수 6개, 모든 업무 테이블의 수정 guard, 문의 resolved 확인·등록 fingerprint, Action 등록 fingerprint·대기 대상/시작일 쌍 제약. owner/id/생성시각/원문을 보존한다. revision은 DB에서 올리고 RPC의 예상 버전으로 동시 수정 충돌을 감지한다.
- db/enable-basic-write.sql: 별도 최종 권한 적용 파일. INSERT/UPDATE와 업무 RPC EXECUTE만 추가한다. DB 소유자 RLS와 기존 허용 계정을 유지한다. DELETE·허용목록 변경·anon 접근 없음.
- db/test-basic-write-body.sql, db/verify-basic-write.sql, tools/prepare-write-validation.mjs: 실제 새 DB의 합성 데이터/임시 스키마/권한 ROLLBACK 검증, 적용 후 읽기 점검, D outputs 적용·검증 SQL 생성.
- web/index.html, web/workspace.mjs, web/app.mjs, web/style.css: 한국어 등록·상세·Action 편집·종료·고객/프로젝트 필터·종료 이력 UI. 고객/담당자/프로젝트는 등록 내 생성과 상세 내 이름/메모 수정. 저장 실패 시 입력 유지, 같은 등록 요청의 재시도, 불확실한 저장 후 이력 확인과 새 입력 시작, 로그아웃 후 업무 입력/표시 정리. 원문은 textContent로만 표시한다.
- tools/dev-server.mjs: 실제 HTTP 쓰기 body 전달과 크기 제한. loopback/Host/Origin 보호 유지.
- tests/write-api.test.mjs, tests/fake-supabase.mjs, tools/ui-fixture-server.mjs: API/입력 테스트, 실제 화면 소스로 만든 격리 브라우저 테스트 환경. 가상 SDK는 운영 빌드에 포함하지 않는다.
- README.md, docs/development-plan.md: 가능한 기능과 남은 실제 검증을 반영했다.

## 업무 규칙과 보존

문의 등록의 고객·담당자·프로젝트 생성과 Inquiry 저장은 하나의 RPC 트랜잭션이다. 중간 오류는 관련 생성도 되돌린다. 요청 UUID와 fingerprint로 네트워크 응답 유실 후 같은 입력의 재시도를 처리한다. 같은 ID에 다른 입력을 보내면 충돌로 알린다. 신규 고객사 중복 이름은 기존 항목을 선택하도록 안내한다.

Action 작성/수정과 문의 종료는 같은 Inquiry 행 잠금을 사용한다. 필수 미완료 Action이 있거나 주요 질문 해결 확인이 없으면 종료하지 않는다. 완료 시각은 DB가 기록하고 취소 사유는 필수다. 종료된 문의와 완료·취소 Action은 다시 수정하지 않는다. 종료 시 남은 선택 업무는 상세 이력에 보존하고 Dashboard의 진행 업무에서 제외한다. 실제 발송에 따른 Waiting 상태 전환과 문의 재오픈은 이 단위에 추가하지 않았다.

기존 PC CRM, 기존 Supabase sp-crm, 원본 자료, 부모 하네스, Auth 비밀번호/키를 변경하지 않았다. 패키지와 lockfile 변경 없음. 운영 소스·기존 실행 경로는 C에 유지했다. 검사 SQL, 증거 이미지, 검증 로그, 리뷰용 빌드와 완료/보류 요약은 `D:/AI/projects/sp-sales-crm/outputs/`에 저장한다.

## 새로 실행한 검증

- Node 테스트 32/32 통과. 서울 날짜, allow/deny, 등록 필드/원문, 소유자 조건, 잘못된 날짜, 취소 근거, RPC 오류 분류, 불확실한 저장 결과, 종료 문의 Action의 Dashboard 제외, 필터/페이지 등을 검증했다. 최종 검토에서 PostgreSQL의 microsecond updated_at을 밀리초로 제한하면 실제 고객 수정이 막히는 문제를 찾아, 6자리 정밀도를 그대로 보존하는 회귀 테스트와 수정도 포함했다. 네트워크는 합성 응답이며 실제 Auth E2E를 대신하지 않는다.
- Python 기존 수집 실험 회귀 테스트 9/9 통과. Outlook 실사서함은 이번 작업에서 읽거나 전송하지 않았다.
- npm run build 성공. 운영 번들은 실제 Supabase SDK를 사용하며 가상 테스트 SDK와 분리된다.
- 실제 새 Supabase SQL 편집기의 합성 데이터 검증 결과 `basic_write_rollback_tests_passed`. 함수/권한/guard 점검, 원자적 등록·재시도, 타인 고객/문의 연결·수정 차단, 비허용/비활성 계정 및 anon 차단, 원문 보존, revision 충돌, 필수 업무 종료 차단, 완료 시각/취소 사유, Closed와 선택 업무 이력 보존을 검증했다. 이 사전 테스트와 임시 권한·스키마는 전부 ROLLBACK했다. 이후 사용자 확인을 받은 실제 지속 적용 결과는 아래에 구분한다.
- 가상 브라우저에서 신규 고객/담당자/프로젝트 + Inquiry 저장 → 실패한 Action 입력 유지·재시도 → 오늘 기한 Dashboard → 완료 → 지난 기한 Action 추가 → 사유 없는 취소 거부 → 사유 있는 취소 → Closed → 고객/프로젝트 필터로 다시 열기 → 고객명 수정/재조회 → 로그아웃 시 입력 정리를 확인했다. 별도 최종 가상 흐름에서 미완료 선택 업무를 남기고 종료한 후 Dashboard 제외와 이력 보존을 확인했다.
- diff --check, 추적/산출물 credential-pattern 점검과 로컬 HTTP 로그인 없는 요청 차단 결과 및 최종 커밋은 D outputs의 검증/요약 파일에 기록한다.

## 실제 적용과 사후 검증

Supabase 커넥터는 USER_NOT_LOGGED_IN이라 사용할 수 없었다. 로그인된 Chrome의 **새 sp-sales-crm** SQL 편집기로 진행했다. 브라우저 도구의 접근 권한 확대 실행 시 확인 정책에 따라 구체적인 SQL과 범위를 제시했고, 사용자가 ‘적용해’라고 실행 시점 승인했다. 같은 범위의 반복 확인 없이 적용했다.

- 최종 적용 SQL SHA256: `afcce9f9be1395261c319315b360bed27bd308cc0fae15b5998c5b4ddc6e9849`. 새 SQL 쿼리 `fedccb5d-0af9-420b-93d1-13f190249ec3`에서 `basic_write_enabled` 확인. DB 규칙과 authenticated INSERT/UPDATE 및 6개 업무 RPC EXECUTE만 지속 반영했다. DELETE·anon·허용목록 쓰기 권한은 추가하지 않았다.
- db/verify-basic-write.sql 실행 결과 `basic_write_post_apply_passed`. 테이블 권한·RLS·guard·지정 계정 1인·invoker RPC·합성 fixture 부재 확인. 쿼리 `153a051e-4d62-4eb5-8c6d-60898fb3a3dc`.
- Security Advisor 재분석: 오류 0건, 초기 경고 3건. public.rls_auto_enable()의 기본 PUBLIC EXECUTE로 발생한 2건과 Auth 유출 비밀번호 보호 비활성 1건이었다. 함수 정의·ACL·활성 ensure_rls를 먼저 읽고 D outputs에 사본을 저장했다. 공식 [이벤트 트리거 문서](https://supabase.com/docs/guides/database/postgres/event-triggers)의 관리용 자동 RLS 함수와 대조했다.
- db/harden-rls-event-access.sql로 관리용 이벤트 함수의 PUBLIC/anon/authenticated EXECUTE를 제한했다. SECURITY DEFINER 구현과 ensure_rls 활성 상태를 보존했다. 트랜잭션 내 임시 테이블에 RLS 자동 활성화됨을 검사하고 savepoint로 제거한 후 권한 제한만 커밋했다. `rls_event_access_hardened` 확인, 검사 테이블 부재 확인. 쿼리 `a7021acc-a6e6-4df9-b13a-61ceefe1d724`.
- 보완 후 Security Advisor: 오류 0건, 경고 1건(Auth 유출 비밀번호 보호 비활성). [공식 비밀번호 보안 문서](https://supabase.com/docs/guides/auth/password-security)에서 Pro 이상 기능임을 확인했다. 무료 사용 조건을 유지하며 유료 전환·Auth 설정 변경은 하지 않았다.
- 보완 후 업무 권한 검사와 관리 함수 접근 차단·ensure_rls 활성·검사 테이블 부재를 다시 읽기 검사해 `basic_write_security_post_apply_passed` 확인. 증거: `2026-10-06-basic-write-final-verify.sql`, `2026-10-06-basic-write-final-verified.png`. 변경 파일 4개의 credential-pattern 검사 0건 및 git diff --check 통과. 코드 변경은 없어 앞서 통과한 Node 32/32·Python 9/9·운영 빌드 결과를 유지한다.
- SQL 편집기 기존 모델 교체에서 입력이 혼합되어 보인 쿼리는 실행하지 않았다. 빈 새 쿼리에 정확한 파일을 입력해 실행했다. 이 현상을 일반 DB 실패와 혼동하거나 같은 혼합 쿼리를 재실행하지 않는다.
- 증거: D outputs의 `2026-10-06-basic-write-applied.png`, `2026-10-06-basic-write-post-verified.png`, `2026-10-06-rls-event-before.txt`, `2026-10-06-rls-event-hardened.png`, `2026-10-06-basic-write-security-before.png`, `2026-10-06-basic-write-security-after.png`.

지정 계정 실제 등록·수정·Closed E2E는 직접 로그인 대기다. 최신 빌드를 로드하며 메모리 로그인 세션이 초기화됐고, 사용자에게 로컬 CRM에서 직접 로그인하도록 안내했다. 비밀번호·토큰은 읽거나 파일/로그에 기록하지 않았다. 실제 쓰기 E2E와 다중 DB 세션의 Action/종료 경합은 별도 미검증이다. 제품검색·AI 서비스·전체 Outlook 연결·백업 복원·실사용은 후속 단계다.

## Git·복원·다음 실행

변경과 이 기록을 같은 로컬 기능 커밋으로 관리한다. 정확한 커밋 ID는 D outputs의 `2026-10-06-basic-work-summary.json`과 git log에서 확인한다. 원격이 없어 push/업로드/배포하지 않는다. .env/notes/dist/node_modules와 D 산출물은 커밋하지 않는다.

기능 구현 커밋은 `0356435`다. 로컬 구현을 복원할 경우 `007e743`의 필요한 파일만 비교해 선택 복원한다. 강제 reset과 사용자 변경 덮어쓰기는 하지 않는다. DB에는 승인된 지속 변경이 있다. 로컬 파일 복원만으로 DB 변경은 복원되지 않는다. 새 DB 데이터를 삭제하거나 임의로 권한을 되돌리지 않는다. DB 복원 필요 시 실제 저장 데이터와 의존성을 확인해 별도 복원안을 준비한다.

다음: 사용자가 로컬 CRM에서 직접 로그인 → 지정 계정 실제 등록·수정·Closed E2E → 가상 검증과 실제 데이터 쓰기 E2E를 구분해서 기록 → 제품 자료/AI 등 선택이 필요한 다음 단계 판단. 이미 적용한 기본 쓰기 SQL은 컬럼·제약·함수 생성이므로 반복 적용하지 않는다.

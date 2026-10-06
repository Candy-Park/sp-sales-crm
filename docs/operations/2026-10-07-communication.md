# 수동 HQ·고객 회신과 질문 검토 작업 기록

승인된 기획서의 커뮤니케이션 단계 구현. AI 서비스·비용은 미결정이므로 수동 초안·번역·원문·실제 발송 기록 경로를 구현했다. 원격 없음, 로컬 브랜치 codex/login-access, 시작 커밋 9c855f1. 2026-10-07 사용자 답변 `회신 기능 DB 적용`을 받은 뒤 실제 DB를 반영하고 사후 권한 검사를 통과했다. 이후 사용자 직접 로그인한 Chrome에서 합성 문의의 실제 제품·회신·종료 E2E와 저장 결과 대조를 통과했다.

## 변경과 보존

- src/communication.mjs·api.mjs·write-input.mjs: 입력 검증, 매 요청 Auth/허용 계정 확인, 소유자·문의 조건의 원문/질문/검토 조회, invoker RPC 경로. 서비스 권한 키나 AI 호출을 추가하지 않았다.
- web/communication.mjs·workspace.mjs·app.mjs·index.html: 수동 초안·복사, 실제 발송/수신 원문·시각, 원문과 별도 번역/요약, 출처 연결, 질문별 검토 및 이전 근거, 대기 대상, Action 완료, 미답변/부분 답변의 종료 차단. 페이지 열기나 복사를 발송으로 취급하지 않는다.
- db/communication.sql·enable-communication.sql: append-only 3개 테이블, owner/allowlist RLS, invoker 함수, 본인 SELECT/INSERT와 업무 RPC만 허용하는 별도 적용 SQL. 문의·질문 검토·메시지 저장은 같은 부모 문의 행을 잠근다. UPDATE/DELETE·anon·새 사용자·허용목록 변경·메일 발송 없음.
- db/test-communication-body.sql·verify-communication.sql·tools/prepare-communication.mjs: 합성 검사 전체 ROLLBACK, 적용 전 조건 및 사후 권한/합성 자료 부재 검사용 SQL. 준비 당시에는 미실행이었으며 아래 실제 DB 반영 절에서 PostgreSQL 검증 결과를 구분한다.
- tests/communication.test.mjs·communication-ui.test.mjs 및 tools/ui-fixture-server.mjs: API/도메인·비동기 UI·격리 화면 검증. 기존 PC CRM·sp-crm·계정·원본·무료 조건·전역 지침·활성 개발 경로 보존.

최신 소스가 요구하는 회신 테이블과 문의 waiting_target/waiting_since 컬럼을 적용했다. 기존 4317 서버만 종료하고 최신 API로 재시작했다. 최신 화면을 로드했으며 실제 로그인은 사용자 직접 입력한다.

## DB 반영 전 검증 결과와 당시 한계

- 입력/권한·API·UI 테스트를 실패 재현 후 구현했다. 최종 Node 58/58, Python 수집 회귀 9/9, npm run build 통과. 실제 AI·Outlook 수집·클라우드 배포 검증을 포함하지 않는다.
- 기존 문의/로그아웃 후 늦은 응답이 원문 화면을 복원하지 않는지, 불확실한 저장 응답에서 입력·요청 UUID가 유지되는지, 복사에 API 쓰기가 없는지, 부분 답변이 자동 완료되지 않는지 검사했다.
- 서버가 1,000건으로 응답을 제한하면 limit=1001만으로 잘림을 감지하지 못했다. 경계 다음 행을 소유자/문의 조건으로 조회해 잘림을 감지하도록 수정했고 실패→통과 재현. 조회 오류/잘림은 질문 0건으로 취급하지 않고 종료를 막는다.
- 격리 브라우저: 문의·HQ 질문·필수 발송 Action → 초안 저장 실패/입력 유지/동일 재시도 → HQ 실제 발송 및 Action 완료/대기 → HQ 받은 원문과 별도 번역 → 부분 답변/종료 차단 → 수동 충분성 검토/이전 근거 유지 → 고객 초안/실제 회신 → 종료 후 원문·5개 메시지·2개 검토 이력 조회. 이는 가상 Auth/DB 응답이며 실제 Supabase 검증과 구분한다. 질문 검토는 합성 사례의 수동 판정이고 실제 납기 확정이 아니다.
- 최종 수정본을 격리 새 세션에서 다시 로드했다. 본문 복사의 실제 클립보드 내용 일치와 발송/메시지 없음, Dashboard의 대기 대상·시작 시각·대기 건수 1, 종료 후 현재 대기 표시 정리, 로그아웃 시 입력 정리를 추가 확인했다.
- 읽기 사전 DB 조회: 새 프로젝트의 메시지/질문 테이블 NULL, 기존 대기 문의 0, enabled 계정 1. 쿼리 eb1e3790-ade1-4e97-9cd1-0dc14d9248c2. 준비된 최종 SQL은 4ca6b7ee-e6c4-43c4-b819-ea8b4d7ec687에 입력만 했으며 실행하지 않았다.
- 실제 DB 규칙/RLS·SQL ROLLBACK·사후 검사·Advisor·실제 로그인 업무 E2E·두 세션 경합은 아직 남아 있다. 전체 MVP 완료가 아니다.

## 산출물·복원·다음 작업

D:/AI/projects/sp-sales-crm/outputs/의 communication-apply.sql·rollback.sql·manifest.json·tests.txt·synthetic-report.json 및 save-failure/partial/closed/approval 화면에 근거를 보관한다. 정확한 SQL 해시는 manifest에 고정한다. 기존 커밋의 소스 백업은 before-communication-9c855f1.zip이다. .env·개인 notes·토큰·비밀번호·원본 PDF는 백업/커밋에 포함하지 않는다.

코드는 9c855f1과 파일별 비교 후 필요한 범위만 복원할 수 있다. 외부 제품 DB는 이미 승인 반영됐으므로 임의로 되돌리지 않는다. 회신 DB도 승인 반영됐으므로 외부 변경은 영향과 승인 범위를 확인한 뒤 복원한다. 커밋/상세 해시는 D 완료 기록에서 연결하며 push·배포하지 않는다.

당시 다음 순서: 회신 DB 실행 시점 확인 → 준비된 ROLLBACK 검사 → 통과할 때만 최종 적용 → 사후 검사·Advisor → 최신 4317 서버 전환 → 사용자 직접 로그인 후 제품/회신 실제 E2E. AI 서비스·비용 선택과 실제 Outlook 수집·백업 복원·1주 실사용은 후속이다.


## 사용자 확인 후 실제 DB 반영 — 2026-10-07

- 사용자 답변 `회신 기능 DB 적용`을 확인했다. 준비 SQL의 SHA-256과 편집기 전체 SQL(줄바꿈 정규화)을 대조하고 실행했다. 준비된 SQL은 재생성하지 않았다.
- 실제 합성 검사 결과 `communication_rollback_passed`: 본인/다른 소유자 격리·비활성 계정/anon 차단, 원문·질문 snapshot, 재시도·충돌·Closed 이후 동일 재시도, 실제 발송 확인·미래 시각·출처/질문 위조 차단, Action 완료·대기, 번역 별도 보존, 부분 답변 종료 차단, 검토 이력·과거 수신의 상태 후퇴 방지, UPDATE/DELETE 금지. 테스트 전체 ROLLBACK.
- 실제 반영 결과 `communication_enabled`. 이어서 db/verify-communication.sql 결과 `communication_post_apply_passed`: 3개 테이블 RLS·SELECT/INSERT만, invoker RPC, anon/수정/삭제 및 trigger helper EXECUTE 차단, enabled 계정 1개, 합성 Auth/문의 부재와 대기 필드 확인.
- Security Advisor 오류 0, 기존 유출 비밀번호 보호 경고 1. 무료 조건 유지. Performance Advisor 오류/경고 0, 참고 21개. 새 3개 테이블의 부모/질문 외래키 인덱스에 대해 실제 constraint 상세를 확인해 추가 SQL을 준비했다. 기존 인덱스를 자동 삭제하지 않는다.
- 쿼리: ROLLBACK 8680bb0a-2a1a-4203-a01c-a22884daff31, 적용 4ca6b7ee-e6c4-43c4-b819-ea8b4d7ec687, 사후 e6ad61f0-1b9b-452c-9b0a-ccf98d4588de. 증거와 정확한 해시는 D outputs의 communication-rollback-passed/applied/post-verified/security 화면·manifest에 보관한다.
- 최신 4317 서버와 로그인 화면 준비. 이메일만 입력했고 비밀번호/토큰을 읽거나 기록하지 않았다. 실제 제품·회신 E2E와 동시 세션 경합은 미완료다. 기획서 요구사항은 변경하지 않았다.


## 인덱스 보완과 서버 전환 완료

- db/communication-indexes.sql을 별도 증분 변경으로 적용했다. sales_message·sales_hq_question의 (inquiry_id,owner_id), sales_hq_review의 (question_id,inquiry_id,owner_id,revision DESC) 인덱스 정의를 실제 검사했다. 결과 `communication_fk_indexes_verified`, 쿼리 d2650705-166c-4a5d-b21e-cd64804c8ef7. 동결된 기존 적용 SQL을 바꾸거나 반복 실행하지 않았다.
- Performance Advisor Rerun linter 후 Unindexed foreign keys만 필터링: 새 회신 테이블 3개 항목 없음. 남은 외래키 참고 8개는 기존 기본/제품 테이블이며, 미사용 인덱스 참고 13개와 합쳐 참고 21개다. 오류·경고 0. 삭제 후보를 확정하지 않았고 인덱스를 삭제하지 않았다. 사후 화면은 communication-performance-verified.png에 보관했다.
- 실제 4317 HTTP 확인: /api/dashboard·products·문의 communication은 로그인 없으면 401, 다른 Origin은 403. 최신 communication-section HTML, 새 프로젝트/공개 키 구성 확인; 키 값은 출력하지 않았다. communication-live-server.json에 최소 결과만 저장했다.
- 전체 업무 E2E는 로그인 대기다. Chrome CRM 화면에 이메일만 준비했고, 사용자에게 비밀번호 직접 입력을 안내했다. 새 로그인 세션·제품 검색/후보 저장·HQ/고객 회신·종료의 실제 화면 검증을 완료로 보고하지 않는다.
- 변경 전 문서는 communication-db-records-before/에 복사했다. 적용 SQL·ROLLBACK SQL·인덱스 SQL과 해시·사후 검사 화면은 D outputs에 보관한다. 기존 CRM·sp-crm·무료 조건·Auth·허용 계정·외부 발송·배포는 보존했다.

남은 다음 작업은 사용자 직접 로그인 후 실제 제품/회신 E2E, 동시 세션 경합, AI 서비스/비용 선택과 실제 Outlook 수집·복원·1주 실사용이다. DB 재적용은 다음 작업에 포함하지 않는다. Git은 로컬 커밋만 하고 원격 업로드하지 않는다.


## 사용자 로그인 후 실제 제품·회신 E2E — 2026-10-07

사용자가 직접 Chrome에서 로그인한 새 탭의 메모리 세션을 사용했다. 새 프로젝트만 접근했고 비밀번호·토큰을 읽거나 저장하지 않았다. `[검증용] 제품·회신 E2E 20261007` 문의와 고객/프로젝트, 메시지는 합성 검증 자료로 명확히 표시했다. 실제 고객 메일을 발송하거나 제품 판매/Packing 정보를 확정하지 않았다.

- 실제 API/DB: LR4 SMF 10km 일치, SR4 OM3 100m 불일치, OM4 100m 일치와 Packing 미확인 구분. 두 후보의 선택/HQ 확인 근거와 snapshot을 저장하고 종료 후 다시 조회했다.
- HQ 질문 → 필수 HQ Action → 초안 복사/저장(상태 유지) → 합성 실제 발송 기록(대기/Action 완료) → 부분 답변 원문·별도 번역·요약 → 부분 검토/종료 차단 → 추가 합성 답변 → 근거 지정 완료 검토/이전 근거 보존 → 고객 초안/회신 기록/Action 완료 → Closed 순서 통과.
- 고객·프로젝트 필터로 종료 문의를 다시 열어 원문·두 후보·6개 메시지·2개 검토·두 완료 Action을 확인했다. 종료 후 Dashboard 대기/미완료 문의는 0이며 로그인 세션은 유지했다. 로그아웃은 이전 실제 기본 업무 검증 및 격리 회신 검증과 구분하며 이번에는 반복하지 않았다.
- 읽기 전용 SQL 대조: 문의 52adc082-e3c2-4794-b60b-658e1253d91a, 상태 closed/revision 6, 현재 대기 필드 NULL, 후보 2, 메시지 6, 출처 연결 4, 별도 번역/요약 1, 질문 1, 근거 있는 partial(revision 2)/answered(revision 3), 필수 Action 2개 completed. 쿼리 1345abb9-484c-4255-9336-7023df64fc57.
- 증거/최소 결과는 D outputs의 2026-10-07-crm-e2e-*.txt/png/sql/json에 저장했다. 이전 준비/가상 검증 기록은 당시 이력으로 보존한다. 작업 전 문서는 crm-e2e-records-before/에 복사했다. 요구사항·기획서는 변경하지 않았다.

남은 검증은 두 실제 세션 경합, 토큰 만료, 실제 고객 사례, Outlook 자동 수집·AI 선택·복원·1주 실사용이다. 다음 승인 단계인 Outlook 수집 연결을 진행한다. 소스는 변경하지 않았고 로컬 기록만 선별 커밋한다. 이전 0540496과 필요한 문서만 비교해 복원하며, 실제 DB의 합성 문의는 보존하고 외부 반영분을 임의 삭제하지 않는다. 기존 PC CRM/sp-crm·원본·무료 플랜·전역 지침·원격/배포 조건을 유지했다.

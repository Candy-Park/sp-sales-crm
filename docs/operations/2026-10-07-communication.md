# 수동 HQ·고객 회신과 질문 검토 작업 기록

승인된 기획서의 커뮤니케이션 단계 구현. AI 서비스·비용은 미결정이므로 수동 초안·번역·원문·실제 발송 기록 경로를 구현했다. 원격 없음, 로컬 브랜치 codex/login-access, 시작 커밋 9c855f1. 새 Supabase의 회신 DB 권한 반영은 실행 시점 확인 대기이며 아직 적용하지 않았다.

## 변경과 보존

- src/communication.mjs·api.mjs·write-input.mjs: 입력 검증, 매 요청 Auth/허용 계정 확인, 소유자·문의 조건의 원문/질문/검토 조회, invoker RPC 경로. 서비스 권한 키나 AI 호출을 추가하지 않았다.
- web/communication.mjs·workspace.mjs·app.mjs·index.html: 수동 초안·복사, 실제 발송/수신 원문·시각, 원문과 별도 번역/요약, 출처 연결, 질문별 검토 및 이전 근거, 대기 대상, Action 완료, 미답변/부분 답변의 종료 차단. 페이지 열기나 복사를 발송으로 취급하지 않는다.
- db/communication.sql·enable-communication.sql: append-only 3개 테이블, owner/allowlist RLS, invoker 함수, 본인 SELECT/INSERT와 업무 RPC만 허용하는 별도 적용 SQL. 문의·질문 검토·메시지 저장은 같은 부모 문의 행을 잠근다. UPDATE/DELETE·anon·새 사용자·허용목록 변경·메일 발송 없음.
- db/test-communication-body.sql·verify-communication.sql·tools/prepare-communication.mjs: 합성 검사 전체 ROLLBACK, 적용 전 조건 및 사후 권한/합성 자료 부재 검사용 SQL. SQL은 준비만 했으며 실제 PostgreSQL 통과로 보고하지 않는다.
- tests/communication.test.mjs·communication-ui.test.mjs 및 tools/ui-fixture-server.mjs: API/도메인·비동기 UI·격리 화면 검증. 기존 PC CRM·sp-crm·계정·원본·무료 조건·전역 지침·활성 개발 경로 보존.

최신 소스는 회신 테이블과 문의 waiting_target/waiting_since 컬럼을 요구한다. 회신 DB 반영 전 최신 서버로 전환하지 않는다. 기존 4317 서버는 이전 API를 유지한다. 실제 서버 전환 후 로그인은 사용자 직접 입력한다.

## 검증 결과와 한계

- 입력/권한·API·UI 테스트를 실패 재현 후 구현했다. 최종 Node 58/58, Python 수집 회귀 9/9, npm run build 통과. 실제 AI·Outlook 수집·클라우드 배포 검증을 포함하지 않는다.
- 기존 문의/로그아웃 후 늦은 응답이 원문 화면을 복원하지 않는지, 불확실한 저장 응답에서 입력·요청 UUID가 유지되는지, 복사에 API 쓰기가 없는지, 부분 답변이 자동 완료되지 않는지 검사했다.
- 서버가 1,000건으로 응답을 제한하면 limit=1001만으로 잘림을 감지하지 못했다. 경계 다음 행을 소유자/문의 조건으로 조회해 잘림을 감지하도록 수정했고 실패→통과 재현. 조회 오류/잘림은 질문 0건으로 취급하지 않고 종료를 막는다.
- 격리 브라우저: 문의·HQ 질문·필수 발송 Action → 초안 저장 실패/입력 유지/동일 재시도 → HQ 실제 발송 및 Action 완료/대기 → HQ 받은 원문과 별도 번역 → 부분 답변/종료 차단 → 수동 충분성 검토/이전 근거 유지 → 고객 초안/실제 회신 → 종료 후 원문·5개 메시지·2개 검토 이력 조회. 이는 가상 Auth/DB 응답이며 실제 Supabase 검증과 구분한다. 질문 검토는 합성 사례의 수동 판정이고 실제 납기 확정이 아니다.
- 최종 수정본을 격리 새 세션에서 다시 로드했다. 본문 복사의 실제 클립보드 내용 일치와 발송/메시지 없음, Dashboard의 대기 대상·시작 시각·대기 건수 1, 종료 후 현재 대기 표시 정리, 로그아웃 시 입력 정리를 추가 확인했다.
- 읽기 사전 DB 조회: 새 프로젝트의 메시지/질문 테이블 NULL, 기존 대기 문의 0, enabled 계정 1. 쿼리 eb1e3790-ade1-4e97-9cd1-0dc14d9248c2. 준비된 최종 SQL은 4ca6b7ee-e6c4-43c4-b819-ea8b4d7ec687에 입력만 했으며 실행하지 않았다.
- 실제 DB 규칙/RLS·SQL ROLLBACK·사후 검사·Advisor·실제 로그인 업무 E2E·두 세션 경합은 아직 남아 있다. 전체 MVP 완료가 아니다.

## 산출물·복원·다음 작업

D:/AI/projects/sp-sales-crm/outputs/의 communication-apply.sql·rollback.sql·manifest.json·tests.txt·synthetic-report.json 및 save-failure/partial/closed/approval 화면에 근거를 보관한다. 정확한 SQL 해시는 manifest에 고정한다. 기존 커밋의 소스 백업은 before-communication-9c855f1.zip이다. .env·개인 notes·토큰·비밀번호·원본 PDF는 백업/커밋에 포함하지 않는다.

코드는 9c855f1과 파일별 비교 후 필요한 범위만 복원할 수 있다. 외부 제품 DB는 이미 승인 반영됐으므로 임의로 되돌리지 않는다. 회신 DB에는 아직 복원할 반영분이 없다. 커밋/상세 해시는 D 완료 기록에서 연결하며 push·배포하지 않는다.

다음: 회신 DB 실행 시점 확인 → 준비된 ROLLBACK 검사 → 통과할 때만 최종 적용 → 사후 검사·Advisor → 최신 4317 서버 전환 → 사용자 직접 로그인 후 제품/회신 실제 E2E. AI 서비스·비용 선택과 실제 Outlook 수집·백업 복원·1주 실사용은 후속이다.

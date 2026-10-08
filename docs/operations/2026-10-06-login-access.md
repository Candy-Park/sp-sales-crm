# 로그인과 접근 검증 작업 기록

개발계획서 2단계 하위 작업. 사용자 승인: 로그인 화면 연결, 지정 계정 허용, 가상 데이터 기반 접근 검증 진행.

## 구현 경계

- 로그인 SDK는 메모리에만 세션을 보관하고 로그아웃·새로고침 시 재인증한다. 비밀번호를 파일·로그에 기록하지 않는다.
- API는 매 요청 Supabase Auth getUser로 로그인 사용자를 검증하고 sales_access의 enabled를 확인한다. 사용자 지정 owner_id를 신뢰하지 않는다.
- 이 단위는 로그인과 읽기 연결까지다. 수동 등록/Action 수정/Closed 트랜잭션은 후속 구현이므로 쓰기 권한은 열지 않는다.
- 새 DB에 지정 계정만 허용하고 authenticated SELECT만 부여할 SQL을 준비한다. RLS 테스트는 트랜잭션 안의 합성 데이터로 수행하고 ROLLBACK한다.
- 브라우저에서 보안상 접근을 확대하는 최종 실행은 도구 정책상 실행 시점 확인을 받는다. 구체적인 SQL·검증·화면을 먼저 준비한다.

## 보존과 Git

부모 하네스 저장소는 변경하지 않는다. 기존 CRM·sp-crm·H 원본 보존. 이 CRM만 별도 로컬 Git으로 관리하며 notes/.env/산출물은 제외한다. 원격 생성·push·배포는 하지 않는다.

## 진행

- 기본 스키마와 API 인터페이스 확인: sales_access SELECT가 없으면 RLS의 allowlist 조회도 실패하므로 SELECT를 같이 열어야 한다. 수정 기능은 이 범위 밖이므로 INSERT/UPDATE는 닫는다.
- 공식 문서와 2026-10-06 changelog 확인: supabase/server 어댑터 폐기 예정 기능은 사용하지 않는다. 기존 일반 Postgres 표준 구성 유지.
- 다음: 실패 테스트 → API/화면 → 빌드/전체 테스트 → 실제 RLS/로그인 검증. 계정 생성 확인은 완료이고 실제 앱 로그인은 아직 미검증.

## 구현과 검증 결과

- src/api.mjs: 원격 Auth 확인 → allowlist 확인 → 소유자 조건으로 제한한 조회. 모든 응답 no-store. 인증되지 않은 요청 401, 비허용 계정 403, 연결/DB 오류 503. 읽기 이외 메서드 405.
- web/: Bootstrap 5.3.8 기반 한국어 로그인과 읽기 Dashboard. Supabase SDK 2.117.2, esbuild 0.28.2를 정확한 버전으로 고정했다. 공개 publishable 키만 로컬 .env에 저장했고 secret 키는 열거나 읽지 않았다. 패키지 설치 audit 취약점 0건.
- API 테스트 RED 9건 → GREEN. 서울 날짜의 실제 DB 필드 집계 테스트 RED → GREEN.
- 독립 검토 지적: 공개 설정 경로의 키 오설정 차단 및 세션 만료 안내 표시를 수정했다. 공개 설정 실패 재현 RED → GREEN. 실제 세션 만료 UI 검증은 사용자 로그인 후 남아 있다.
- Supabase 새 DB에서 verify-login-access.sql 실제 실행 결과 login_access_rollback_tests_passed. 기본 6개 테이블 대상으로 허용 계정 본인 조회·타인 격리·비허용/비활성 계정 차단·anon 거부, 허용목록 자기 수정 거부, 읽기 단계의 INSERT 거부, 다른 소유자 고객 연결 FK 거부를 검증했다. 전체 가상 데이터와 임시 GRANT는 ROLLBACK됐다. 실제 권한 적용과 사용자 로그인 성공은 별도다.
- SQL editor의 비어 있지 않은 모델 교체가 다시 실패해 혼합 텍스트가 보였다. 실행하지 않고 새 쿼리로 이동한 뒤 정확한 textbox 클릭·입력으로 읽기 권한 SQL을 준비했다. 실제 실행은 정책상 사용자 최종 확인을 기다린다.
- 새 로컬 저장소 codex/login-access 초기화. 부모 하네스는 보존했다. .env/notes/node_modules/dist 제외 확인. 원격 없음.
- 최신 전체 Node 20개, Python 9개 통과. npm run build 성공. 로컬 HTTP 실제 확인: 인증 없는 API 401, 다른 Origin 요청 403, 공개 config의 publishable 형식 유효. 실제 Chrome 로그인 화면 표시 확인. 비밀번호는 입력하지 않았다.
- 남은 작업: 최종 SELECT 적용 확인 → 사용자 직접 로그인 → Dashboard 실제 재조회와 로그아웃 검증. 권한 쓰기·동시 수정·문의 등록은 후속 개발.

## 권한 최종 승인과 적용

사용자가 지정 계정의 본인 데이터 조회 권한 적용을 선택했다. 준비된 새 프로젝트 SQL을 실행해 login_read_access_enabled 확인. 승인 범위인 허용 계정과 authenticated SELECT만 반영했고 실제 업무 데이터는 삽입하지 않았다. 증거: outputs/2026-10-06-login-read-enabled.jpg.

적용 후 verify-login-read.sql 실제 실행 결과 login_read_post_apply_passed. 전체 6개 테이블의 authenticated SELECT, anon 거부, authenticated 쓰기 권한 없음, RLS, 지정 계정만 enabled, 가상 Auth/업무 데이터 부재를 확인했다. 증거: outputs/2026-10-06-login-read-post-verified.jpg. 최종 독립 재검토에서 수정 범위의 추가 차단 결함 없음. 실제 사용자 로그인/만료 UI·Dashboard 조회·로그아웃은 사용자 직접 로그인 후 이어서 검증한다.

## 보존 및 복원

기존 sp-crm, PC CRM, H 원본 변경 없음. 새 UI/API는 파일 단위 Git 복원 가능. 실행 중 로컬 서버를 종료하면 화면 접근이 중단된다. 외부 DB 권한은 사용자 승인 없이 임의로 되돌리지 않는다. DB 검증 사진과 로그인 준비 화면은 지정 D outputs에 보관했다.

## 로컬 커밋

기초 코드와 로그인 구현을 포함한 선택 파일 35개를 b632c30 (`feat: establish CRM foundation and read-only authenticated workspace`)으로 커밋했다. 커밋 전 credential-pattern 검사와 diff --check 통과, .env/notes/dist/node_modules 추적 없음 확인. 원격은 없고 push·공개 업로드·배포하지 않았다.

## 실제 로그인 확인

사용자 직접 로그인 완료 후 Chrome의 업무 화면에서 지정 계정과 '현재 계정의 업무를 확인했습니다.' 표시를 확인했다. 새 DB에는 실제 업무를 아직 넣지 않아 미완료 Action과 진행 문의가 비어 있다. 새로고침 버튼으로 인증된 실제 API 재조회 성공을 확인했다. 이후 로그아웃 버튼으로 업무 데이터와 사용자 표시가 닫히고 비밀번호가 비어 있는 로그인 화면으로 돌아오며 '로그아웃했습니다.' 표시를 확인했다.

증거: outputs/2026-10-06-crm-login-verified.jpg 및 outputs/2026-10-06-crm-logout-verified.jpg. 현재 화면은 확인용 로그아웃을 마친 로그인 화면이다. 이번 로그인/조회/로그아웃 흐름은 실제 검증 완료. 토큰 만료 UI와 전체 업무 E2E·쓰기 기능은 별도 미완료다. 다음 작업은 2단계의 고객·수동 문의 등록과 Action/Closed의 DB 업무 규칙 연결이다.
## 2026-10-08 실제 액세스 토큰 만료 검수 화면 준비

두 실제 세션 수정 검수 후 사용자가 별도 검수 화면 준비를 승인했다. 시작 cddc9a6, codex/login-access, clean·원격 없음. tools/expiry-auth.mjs·expiry-sdk.mjs·expiry-server.mjs와 tests/expiry-auth.test.mjs를 추가했다. 운영 web/src·DB·Auth 설정·기존 CRM 4317과 두 로그인 탭은 유지했다. 설치된 Supabase SDK 2.117.2의 getSession이 자동 갱신 비활성화 상태에서도 만료 임박 시 갱신할 수 있음을 소스로 확인해, 별도 빌드에서만 최초 로그인으로 발급된 실제 액세스 토큰을 메모리 내 고정하는 검수 어댑터를 사용한다. 비밀번호·토큰을 도구 출력/파일/로그에 기록하거나 기존 탭에서 추출하지 않는다.

4321 loopback 검수 서버는 실제 CRM UI 소스를 별도 D outputs/expiry-ui에 빌드하고 기존 인증/RLS API를 사용한다. 모든 업무 쓰기는 405로 차단하며, 실제 만료 이후 조회의 401 및 로그인 복귀/개인 화면 정리를 검수한다. 최초 토큰 만료 시각 65초 뒤 Dashboard 조회를 한 번 수행하며, 401 이외 결과는 미완료로 표시한다. 이는 자동 갱신을 제어한 별도 빌드의 실제 액세스 토큰 만료 검사이며 운영 자동 갱신 실패·전체 세션 수명 검수로 확대하지 않는다.

새 검증: 관련 Node 24/24(검수 어댑터 3, 기존 인증/쓰기 API 포함), 새 별도 브라우저 번들 생성, server/sdk 문법 검사, HTTP / 200·인증 없는 /api/me 401·업무 POST 405·다른 Origin 403 확인. Chrome Personal_Candy 프로필의 4321 로그인 화면과 검수 안내를 확인했다. 실제 사용자 로그인·토큰 만료·401 이후 UI 검수는 아직 미실행이며 사용자 직접 로그인 대기다. 운영 빌드를 다시 만들거나 DB 쓰기 검수로 보고하지 않는다.

근거: 공식 https://supabase.com/docs/guides/auth/sessions 및 설치 SDK GoTrueClient.__loadSession. changelog.md는 web에서 content-type으로 열리지 않아 변경 로그 검토를 완료했다고 주장하지 않는다. 사전 문서 사본은 D outputs/expiry-ui-before/{operation-before,report-before}.md. 변경 기록/도구만 선별 로컬 커밋, push/배포 없음. 복원은 cddc9a6와 해당 파일만 비교하며 검수 종료 시 정확한 4321 프로세스만 정리한다. 4317 서버·기존 세션·운영 데이터는 보존한다. 실제 만료 결과와 Auth 복원·AI 선택/평가·1주 실사용은 미완료다.

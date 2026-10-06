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

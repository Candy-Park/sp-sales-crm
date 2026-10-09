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
### 사용자 직접 로그인 확인·자연 만료 대기 — 2026-10-08

사용자가 4321 검수 탭 로그인 완료를 알린 뒤 실제 Personal_Candy Chrome 탭의 인증된 Dashboard와 정상 계정 조회 안내를 확인했다. 21:14 서울 무렵 검수 안내는 만료 이후 인증 확인까지 3615초, 후속 조회는 3585초로 감소했다. 최초 토큰의 자연 만료를 대기 중이며 401·로그인 복귀 검수는 아직 실행되지 않았다. 예정 확인은 약 22:14 서울로 추정하며 실제 배너 결과를 재확인해야 한다. 기존 4317 두 탭의 로그아웃 버튼 표시로 두 로그인 유지를 확인했고 4317/4321 모두 loopback listener를 유지한다. 비밀번호·토큰·SDK 세션 객체는 조회하지 않았다. 실제 로그인 확인을 만료 검수 완료로 기록하지 않는다.

소스·DB·Auth 설정·운영 자료·원격·배포 변경 없음. 이 기록과 개발 보고서만 갱신하며 사전 사본은 D outputs/expiry-ui-before/{operation-before-login,report-before-login}.md. 검증은 실제 인증 화면/배너 및 기존 탭 상태·listener 조회·git diff --check다. 로컬 선별 커밋 후 자연 만료 대기 상태를 남기며 예약/자동화 도구는 생성하지 않았다. 검수 탭의 기존 타이머가 인증 조회를 한 번 수행한다. 다음은 해당 탭에서 실제 HTTP 결과 안내와 로그인 복귀/업무 화면 정리를 확인하는 것이다. 문서 복원은 e1b2d55 또는 해당 사전 사본과 파일별 비교한다.

### 2026-10-08 자연 만료 후속 확인 예약·Docker 시작 오류 진단

위의 예약 없음은 당시 상태다. 이후 사용자가 한 시간 후 확인을 요청하여 이 채팅의 후속 확인 자동화 `crm`을 생성했다. 생성 시각은 21:19 서울 무렵이며, 4321 검수 탭의 실제 401 안내·로그인 복귀·업무 화면 정리와 기존 4317 보존을 확인한 뒤 결과를 기록하고 반복을 중지하도록 지정했다. 실제 만료 결과는 아직 미확인이다.

Auth 서비스 격리 복원 준비에서 기존 Supabase 프로젝트의 무료 Session pooler 접속 경로와 TCP 연결을 확인했다. 사용자가 DB 비밀번호를 보관하고 있다고 답했으나 비밀번호를 채팅·파일·로그로 받지 않았고, 인증 백업·복원은 실행하지 않았다. 고정 Supabase CLI 2.120.0을 D npm 캐시에 준비하고 dump 도움말을 확인했다. 새 유료 자원·외부 AI 호출·운영 DB 변경은 없다.

Docker Desktop 4.80.0의 사용자 첨부와 호스트 로그에서 `Docker/run/dockerInference` 통신 파일 접근 실패를 확인했다. 종료 후에도 해당 0바이트 reparse point를 Windows가 오류 1920으로 읽지 못했다. 사용자가 run 폴더를 보존하고 재생성하는 복구 계획을 승인했다. Docker 프로세스 종료, 대상 절대 경로·부모 일반 디렉터리·백업 미존재를 확인한 후 `C:/Users/Candy Home/AppData/Local/Docker/run`을 같은 부모의 `run.backup-crm-20261008-2156`으로 이동하고 빈 run 폴더를 생성했다. 기존 통신 항목 3개(dockerEthernetVfkit, dockerInference, userAnalyticsOtlpHttp.sock)를 이름·길이·속성으로 확인해 모두 보존했다. 접근 불가 항목의 내용 해시 검증은 수행하지 않았다. 컨테이너·DB·설정·WSL 데이터는 이동/삭제하지 않았다.

21:59 서울 Docker 재시작 후 dockerInference 새 항목은 생성됐지만 엔진 조회가 18초 안에 응답하지 않았다. 새 오류는 `C:/Users/Candy Home/AppData/Local/docker-secrets-engine/engine.sock`의 동일한 접근 실패다. 해당 폴더에는 0바이트 reparse point engine.sock 한 개가 있고 fsutil 조회도 Windows 오류 1920이다. 사용자 후속 첨부의 Secrets Engine 오류와 일치한다. 이 경로는 앞서 승인한 run 밖이므로 통신 파일 하나를 백업 이름으로 보존하는 추가 범위를 승인 요청했으며 아직 변경하지 않았다. 공장 초기화·진단 보고서 업로드·운영 자격증명 조회는 하지 않았다. Docker 정상 가동과 Auth 서비스 복원·로그인 검수는 미완료다.

문서 사전 사본은 D:/AI/projects/sp-sales-crm/outputs/2026-10-08-docker-recovery/login-operation-before.md다. 복구를 되돌릴 때는 Docker를 종료하고 새 run 폴더도 별도 이름으로 보존한 후 위 run 백업을 원래 위치로 복원한다. 경로와 현재 상태를 다시 확인하고 기존 항목을 덮어쓰거나 삭제하지 않는다. 이번에는 작업 기록만 선별 로컬 커밋하며 원격 없음·push/배포 없음. 다음은 추가 통신 파일 보존의 사용자 승인 후 엔진 응답 확인이며, 토큰 만료 결과는 별도 검수로 유지한다.

### 2026-10-08 후속 보존 결과와 재발 원인 범위 확인

사용자가 engine.sock 보존을 추가 승인했다. Docker 프로세스가 없음을 확인하고 파일 이름 변경을 시도했지만 PowerShell Move-Item과 네이티브 MoveFileExW 모두 Windows 오류 1920으로 실패했다. Python의 lexists도 해당 접근 불가 항목에서 false를 반환하므로 파일 소실 증거로 해석하지 않는다. 실제 부모 디렉터리 열거에서 engine.sock 한 개만 존재하고 부모가 일반 디렉터리임을 다시 확인했다. 승인한 통신 파일 하나의 보존을 위해 부모 `C:/Users/Candy Home/AppData/Local/docker-secrets-engine`을 `docker-secrets-engine.backup-crm-20261008`로 이동하고 원래 위치에 빈 디렉터리를 만들었다. 보존한 항목의 이름·0바이트 길이·reparse 속성을 확인했다. 내용·ACL 접근 및 해시 검증은 불가능했다. 새 보존 대상이나 운영 데이터로 범위를 넓히지 않았다.

22:02 서울 재시작은 다시 Inference manager 오류로 종료됐다. 현재 run의 dockerInference는 21:59에 첫 보존 작업 후 새로 생성된 항목이며, 후속 시작 때 같은 오류 1920으로 접근 실패했다. 사용자가 반복 백업을 멈추고 원인을 찾도록 지시했으므로 추가 보존/재시작/설정 변경은 중지했다. 보존 폴더는 두 개이며 담긴 통신 항목은 총 네 개(열거된 논리 길이 모두 0바이트)다. 대용량 DB/VM 복제는 하지 않았으며 실제 할당 공간 측정이나 보존물 삭제는 수행하지 않았다.

진단 환경은 Docker Desktop 4.80.0.232116, Windows 11 Pro 25H2 build 26200.9550, afunix 드라이버 Running·파일 버전 10.0.26100.8972, C/D NTFS HealthStatus Healthy다. 볼륨 HealthStatus는 전체 디스크 무결성 검사를 의미하지 않는다. 파일 필터 목록 조회는 권한 부족으로 실패했고 권한을 우회하거나 보안 설정을 바꾸지 않았다. 설정의 선택 키만 읽어 EnableDockerAI=false·EnableInference 명시 없음·UseContainerdSnapshotter=true를 확인했다. 설정 전체나 자격증명은 출력하지 않았다.

독립 대조 시험은 네이티브 Winsock으로 프로젝트 notes의 공백 포함 C 경로와 D scratch 경로 각각에서 AF_UNIX socket → bind → listen → closesocket → no-follow metadata handle → 같은 디렉터리 이름 변경 → 정확한 시험 파일 삭제를 수행해 모두 성공했다. 시험 파일은 두 위치 모두 정리됐으며 백업을 만들지 않았다. 앞선 .NET 시험은 finally 구문 오류로 종료 순서를 보장하지 못했으므로 근거로 채택하지 않고 이 네이티브 시험으로 대체했다. Docker가 만든 현재 dockerInference와 보존된 engine.sock은 FindFirstFileW로 AF_UNIX tag 0x80000023·0바이트·속성 1056을 읽었지만, CreateFileW OPEN_EXISTING/access 0/share read-write-delete/OPEN_REPARSE_POINT의 읽기 전용 접근은 둘 다 오류 1920이다. 따라서 일반 AF_UNIX 기능 장애로 단정할 수 없으며, 확인된 직접 실패는 Docker가 만든 소켓의 수명/후속 정리 처리에 집중된다. Docker 내부 구현이나 Windows/필터 상호작용의 최종 원인까지 확정한 것은 아니다.

공식 이슈 https://github.com/docker/desktop-feedback/issues/625 에 같은 다중 소켓 재발과 독립 Winsock 성공이 보고돼 있으며, Docker 담당자는 2026-09-30 댓글에서 4.92에 관련 수정을 제공했다고 밝혔다. 사용자 보고의 MFT 손상·커널 잠금 추정은 이 PC에서 검증된 사실로 취급하지 않는다. 공식 https://docs.docker.com/desktop/release-notes/ 에서 2026-10-05의 4.94.0 배포와 Windows 다운로드/체크섬 링크를 확인했다. 개별 이슈 수정이 릴리스 노트에 명시돼 있다고 확대하지 않는다. 다음 제안은 공식 수정 포함 4.94의 데이터 보존 인플레이스 업데이트 후 엔진 조회 및 정상 종료/재시작 검증이다. 공용 앱 변경 승인은 아직 받지 않았고 설치 프로그램 다운로드·설치·재부팅은 수행하지 않았다. CRM/Auth 데이터·설정·기존 로그인·원격·배포는 변경하지 않았다. Docker 복구와 Auth 서비스 복원은 여전히 미완료다. 이 기록만 선별 로컬 커밋하고 복원은 해당 기록의 Git 파일별 비교로 수행한다.

### 2026-10-08 22:15–22:18 서울 실제 토큰 만료 결과 확인

사용자가 예약한 후속 확인에서 Chrome Personal_Candy의 기존 4321 탭(1922550848)을 새로고침/재로그인 없이 읽었다. 첫 관찰은 만료 대기 0초·Dashboard 조회 중이었고, 후속 관찰에서 검수 배너가 `실제 만료 후 API 401 확인`으로 바뀌었다. 이 배너는 원래 fetch 응답 status 401을 읽어 표시하는 검수 래퍼의 결과이며 합성 응답이나 개발자 도구의 토큰 조작을 사용하지 않았다. 화면에 로그인 폼과 `로그인이 만료됐습니다. 다시 로그인해주세요.` 안내가 보이고 업무 공간은 숨겨졌다. 401 안내는 성공했지만 최초 조회 중 상태를 완료로 처리하지 않았다.

DOM 읽기 전용 검증에서 login-view 표시·workspace 숨김·계정 표시 비움, Action/문의/문의 이력/상세 Action/상대 편집/Outlook/연결 메일 목록의 자식 0, 문의 원문/제목/메타 비움, Outlook 검토 숨김과 제목/본문/메타/업무 단계 제안/분류 제안/확정 표시 비움, 제품 검색/이력 목록 비움을 확인했다. 처음 사용한 두 Outlook ID는 실제 HTML에 없는 ID여서 증거에서 제외하고 실제 outlook-subject/outlook-body로 확인했다. 자격증명·토큰·SDK 세션 객체·비밀번호 필드 값은 읽거나 출력하지 않았다. 로그인 이메일 입력의 보존 상태는 이번 업무 화면 정리의 판정 범위에 포함하지 않는다.

기존 4317 두 탭(1922550819, 1922550840)의 로그아웃 버튼이 계속 표시됨을 읽기만 하여 로그인 유지를 확인했고, 4317/4321 loopback listener도 유지했다. 운영 DB/Auth 설정·데이터·앱 소스·번들·기존 세션 변경 없음. 4321 결과 탭은 사용자가 볼 수 있도록 유지했다. 이번 결과는 최초 실제 토큰을 검수 빌드에서 고정하고 자연 만료 이후 실제 조회하여 401·로그인 복귀·화면 정리 상태를 확인한 통과다. 운영 SDK의 자동 갱신 실패·refresh token/전체 세션 수명, 원문을 열어 채운 화면에서의 자연 만료 시나리오는 이번 실행에 포함하지 않는다. 해당 숨겨진 원문 영역은 만료 전 비어 있던 상태이며 만료 후에도 비어 있음을 확인했다.

후속 예약 crm은 공식 automation_update로 PAUSED 처리하여 반복을 중지했고 저장된 automation.toml의 상태를 재확인했다. 결과와 한계는 이 기록 및 개발 보고서만 선별 로컬 커밋한다. 새 백업 파일은 생성하지 않았고 문서 복원은 직전 3325fce와 파일별 비교한다. 문서 변경의 새 검증은 git diff --check와 실제 Chrome/DOM·listener·예약 상태 확인이며 기존 기능 테스트를 이번에 새로 실행했다고 보고하지 않는다. 원격 없음·push/배포 없음. Docker 업데이트/재부팅은 미실행이며 Windows Update와 Component Servicing의 재부팅 대기 표시를 확인해 원격 사용 중에는 재부팅 없는 후속 검수를 먼저 마쳤다. 남은 작업은 Docker 복구 후 Auth 서비스 복원·직접 로그인, AI 선택/평가와 1주 실사용이다.

### 2026-10-08 Docker 공식 설치 파일 다운로드

사용자가 다운로드만 요청하여 공식 릴리스의 Windows x64 Docker Desktop 4.94.0 설치 파일을 D:/AI/projects/sp-sales-crm/sources/installers/Docker-Desktop-4.94.0-Installer.exe에 저장했다. 실제 ProductVersion 4.94.0.241994, 파일 크기 635493296바이트, SHA-256 a9814e31049d66156477a86614e83365669677733014ec72f74229623ff3890a를 확인했다. 공식 https://desktop.docker.com/win/main/amd64/241994/checksums.txt와 일치하며 Authenticode Valid·서명자 Docker Inc를 확인했다. 설치 파일 출처는 공식 https://docs.docker.com/desktop/release-notes/의 4.94.0 Windows 링크다. 설치 파일 실행·업데이트·약관 동의·설정 변경·PC 재부팅은 수행하지 않았고 기존 Docker 4.80과 데이터/설정은 유지했다. 추가 백업은 생성하지 않았으며 설치 파일은 저장소 밖에 있다. 이 기록만 선별 로컬 커밋하고 원격/push/배포 없음. 다운로드 취소 시 영향 대상은 위 설치 파일 하나이며, 삭제는 이번 요청에서 실행하지 않았다. Docker 업데이트와 정상 종료/재시작 검증·Auth 서비스 복원은 미완료다.

### 2026-10-08 사용자 설치 후 Docker 정상 기동 확인

사용자가 직접 설치를 마친 뒤 확인을 요청했다. 기존 C:/Program Files/Docker/Docker/Docker Desktop.exe의 ProductVersion 4.94.0.241994를 읽어 설치 완료를 확인했다. 첫 조회에서는 Docker 프로세스와 Linux 엔진 pipe가 없어 엔진 연결에 실패했으므로 설치 완료와 가동 완료를 구분했다. 설치된 공식 앱을 한 번 실행한 뒤 새 docker info 조회가 성공했으며 ServerVersion 29.8.2·OSType linux·컨테이너 5개·이미지 7개를 반환했다. 새 호스트 로그의 2026-10-08T14:35:00Z(서울 23:35)에서 linux/wsl engine running after 18.512s를 확인했다. 이번 시작은 이전 Inference/Secrets Engine 시작 오류를 넘어 정상 엔진 응답까지 통과했다. 기존 객체 전체 내용이나 업데이트 전후 해시 비교를 수행한 것은 아니므로 전체 데이터 보존 검증 완료로 확대하지 않는다.

설치와 이번 정상 시작 확인은 완료이며, 정상 종료 후 재시작의 반복 안정성 검수·Auth 서비스 격리 복원/직접 로그인은 아직 미완료다. 기존 컨테이너를 중지/재시작하거나 DB/Auth/설정을 변경하지 않았고 추가 백업·진단 업로드·PC 재부팅은 하지 않았다. Windows Update/Component Servicing의 재부팅 대기 표시도 계속 존재하므로 엔진 정상 응답을 재부팅 대기 해소로 해석하지 않는다. 확인 결과만 이 기존 기록에 남기며 diff --check 후 선별 로컬 커밋·원격 없음/push 없음. 문서 복원은 직전 ca09b32와 파일별 비교한다. 기존 보존 폴더와 다운로드 파일을 임의 삭제하지 않았으며 새 복제 파일은 만들지 않았다.

### 2026-10-09 Docker 정상 종료·재시작 검수

사용자가 Docker Desktop 앱 정상 종료 후 재시작 검수를 승인했다. 시작 전 컨테이너 5개의 ID/이름/실행 상태를 확인했다. 공식 docker desktop stop --timeout 45가 exit 0으로 완료됐고 Docker Desktop/com.docker.backend 프로세스가 없음을 확인했다. 강제 종료 없이 설치된 4.94 앱을 다시 실행한 뒤 새 docker info에서 엔진 29.8.2·컨테이너 5·이미지 7 응답을 확인했다. 전후 컨테이너 ID 5개가 모두 동일하며 모두 Up 상태다. DB/Auth/Kong 및 bh-service-postgres의 health 표시는 healthy, REST는 health 표시 없이 실행 상태다. 이번 한 번의 정상 종료/재시작에서 이전 소켓 오류는 재발하지 않았다. 장기간·PC 재부팅 안정성이나 컨테이너 내부 데이터 전체 비교를 의미하지 않는다.

PC 재부팅·설정/DB/Auth 변경·추가 백업·삭제·원격 업로드 없음. 승인된 앱 종료 동안 해당 Docker 서비스들은 잠시 중단됐다가 기존 컨테이너로 돌아왔다. 결과만 기존 기록에 남기고 diff --check 후 선별 로컬 커밋한다. 복원은 직전 기록과 Git 파일별 비교이며, 실제 복구 검수/컨테이너 내부 기능 검증은 별도로 판단한다. Docker 종료/재시작 검수는 통과, 실제 운영 Auth 백업 복원 검수 등 잔여 업무는 별도다.
### 2026-10-09 PC 재부팅 후 인증 복원 검수 재개

사용자가 PC 재부팅을 마치고 잔여 작업 진행을 요청했다. Docker Desktop 4.94의 Linux 엔진 29.8.2 응답과 기존 컨테이너 5개의 재가동을 확인했다. 기존 synthetic Supabase는 다른 프로젝트 경로 소속이므로 복원 대상으로 사용하지 않는다. CRM 4317 loopback 서버를 다시 시작해 HTTP 200·익명 /api/me 401을 확인했다. PC 재부팅 전 Chrome 로그인 상태가 그대로 유지됐다고 주장하지 않는다. 앞서 완료한 실제 토큰 만료 검수는 재실행하지 않았다.

tools/auth-backup.mjs와 tests/auth-backup.test.mjs를 추가해 사용자 직접 DB 비밀번호 입력용 loopback 4323 화면을 준비했다. 정확한 Host/Origin·일회용 nonce·입력 크기를 확인하고 비밀번호는 CLI 자식 환경변수로만 전달한다. 비밀번호를 명령 인자·로그·저장소에 기록하지 않으며, 운영 DB는 읽기 전용 roles/schema/data SQL 내보내기 대상으로만 사용한다. 백업 디렉터리는 D sources/auth-backup-20261009에 준비하고 상속을 차단해 현재 사용자·SYSTEM·Administrators에만 접근을 허용했다. 아직 실제 자격증명 연결과 SQL 생성은 실행되지 않았다. 무료 Session pooler를 사용하며 유료 API 호출·운영 DB/Auth 변경은 없다.

새 검증: Node 전용 테스트 3/3, 도구 문법 검사, 실제 HTTP의 다른 Origin 403·잘못된 nonce 400 및 거부 후 ready 상태를 확인했다. Chrome Personal_Candy의 입력 화면을 열어 사용자에게 전달했다. DB 비밀번호 직접 입력이 필요한 상태이며, 실제 백업·별도 로컬 Auth 복원·복원 계정 로그인은 미완료다. 공식 restore-from-platform/backup-restore 문서와 CLI 2.120.0 도움말을 참고했다. 변경 로그 목록을 조회했지만 모든 관련 변경의 영향 검토를 완료했다고 주장하지 않는다.

보존: 운영 DB/Auth, 기존 synthetic 컨테이너와 다른 프로젝트, 기존 Docker 보존 폴더, CRM 앱 소스·SQL·기존 검수 결과를 유지했다. 새 SQL 백업은 아직 없고 추가 Docker 백업도 만들지 않았다. 도구·전용 검사·이 기록·개발 보고서만 선별 로컬 커밋하며 원격 없음·push/배포 없음. 복원 방법은 17ee403과 이번 파일만 비교하고, 검수 종료 시 정확한 4323 도구 프로세스만 종료하는 것이다. 다음 작업은 사용자 입력 후 생성 파일의 크기/체크섬 확인, 기존 DB와 분리된 환경 복원, 사용자 직접 로그인 검수다.

### 2026-10-09 실제 SQL 백업·격리 Auth 데이터 복원 결과

사용자 직접 비밀번호 입력 후 4323 도구가 exported 상태가 됐다. 버튼 비활성화는 완료 후 중복 실행 방지 동작이었다. roles/schema/data SQL 3개와 manifest를 생성했고 크기·SHA-256 재검증이 모두 일치했다. DB 접속 비밀번호를 채팅이나 로그로 받지 않았다. 백업은 D sources/auth-backup-20261009에 있으며 운영 DB/Auth를 변경하지 않았다.

D scratch/auth-restore-20261009에 현재 사용자·SYSTEM·Administrators만 접근 가능한 격리 복원 경로를 준비했다. 새 내부 Docker network crm-auth-restore-20261009, 새 DB crm-auth-restore-db와 Auth crm-auth-restore-auth만 생성했다. DB 이미지 17.6.1.171·GoTrue v2.197.0을 사용하며 새 로컬 DB/JWT 비밀값은 해당 private 경로에만 보관한다. 기존 synthetic 프로젝트의 데이터·설정·컨테이너를 바꾸지 않았고 baseline 시작 명령과 Storage 스키마만 읽기 전용 참고했다. DB 외부 포트는 없고 Auth 4324는 loopback으로 지정했으나 internal network에서 실제 published endpoint가 없어 외부 접속은 되지 않는다. 실제 GoTrue /health는 격리 DB 컨테이너 내부 curl로 응답 확인했다.

시작 명령 전달 오류로 실패한 새 빈 DB 컨테이너만 상태·이미지·빈 pgdata를 확인한 뒤 재생성했다. 원래 컨테이너/volume이나 파일을 삭제하지 않았다. roles/schema/data 일괄 트랜잭션은 누락된 supabase_realtime_admin 역할·Storage 내부 테이블 문제로 실패하고 rollback됐다. 새 복원 DB의 관리자 권한으로 필요한 빈 관리 역할을 초기화한 뒤 roles/schema를 별도 트랜잭션으로 반영했다. Storage baseline에는 테이블이 없었고 원본 Storage COPY 블록 7개가 각각 실제 0건임을 확인했다. 원본 data.sql은 수정하지 않고 호환 사본에서 그 빈 블록만 제외했다. Auth 데이터나 세션·refresh token 행은 제외하지 않았다. 최종 데이터 트랜잭션은 통과했다. 이는 Storage 서비스/파일 복원 검증을 포함하지 않는다.

새 검증: Auth 26개·public 업무 14개, 합계 40개 테이블의 원본 COPY 행과 복원 COPY 행을 정렬 후 해시 비교해 모든 행 수·내용이 일치했다. 사용자 1·identity 1을 포함한다. 상세 집계만 private verification.json에 보관한다. 첫 비교 도구의 1MiB 버퍼 초과 오류에서 일부 Outlook 메일 본문이 도구 출력에 노출됐다. 예외 출력 차단과 충분한 버퍼를 적용해 재실행했고 최종 검증 출력은 집계만 포함했다. 본문을 문서/저장소에 복사하지 않았다. 신규 Auth migration 상태나 전체 Storage 기능까지 완전한 운영 복구로 주장하지 않는다.

복원 계정 로그인 확인용 loopback 4325 서버 소스를 private scratch에 준비하고 문법 검사했다. 기존 CRM 이메일/로그인 비밀번호를 사용해 실제 GoTrue password login·/user·CRM 접근 매핑을 확인하도록 구성했으나 서버 실행이 자동 승인 검토에서 정책 차단됐다. 구체적인 추가 사유는 제공되지 않았다. 우회 실행하지 않았고 실제 복원 계정 로그인 검수는 미완료다. 4323 백업은 완료했으므로 재입력/중복 실행하지 않는다.

원격 없음·운영 변경·유료 API 호출·배포 없음. 이번에는 이 작업 기록과 개발 보고서만 선별 로컬 커밋한다. 민감 SQL·환경 파일·대화/본문·private helper를 Git에 넣지 않는다. 다음은 허용된 실행 환경에서 로그인 검수 서버를 실행하고 사용자 직접 로그인 후 결과를 확인하는 것이다. 복원 환경을 정리하려면 정확한 새 crm-auth-restore-* 컨테이너/내부 network와 위 D private 경로만 대상으로 하며, 기존 환경이나 백업을 삭제하지 않는다. 현재는 복원 DB/Auth를 보존하고 정리하지 않았다.

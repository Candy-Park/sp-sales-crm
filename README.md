# Source Photonics sales CRM

1인 영업 CRM의 MVP. 개발 범위와 검수 기준은 [기획서](docs/development-plan.md)를 따른다. 조사·결정과 작업 이력은 [문서 안내](docs/README.md)의 구분에 따라 별도로 관리한다.

## 현재 가능한 기능

로컬 로그인, Supabase Auth 인증, 허용 계정 확인, 본인 Dashboard 조회에 더해 수동 문의 등록·상세·종료 이력, 고객/담당자/프로젝트의 문의 내 생성과 이름/메모 수정, Action 등록·편집·완료·사유 있는 취소, 문의 Closed 처리를 구현했다. **2026-10-06 사용자 확인 후 새 DB의 업무 규칙과 쓰기 권한을 적용했고 사후 권한 검사를 통과했다.** 지정 계정 로그인 후 검증용 입력으로 실제 등록·수정·Action 처리·종료·이력 재조회를 확인했다.

원문은 수정으로 덮어쓰지 않고 HTML 삽입 없이 출력한다. 저장 실패·충돌 시 입력을 유지하고 재조회할 수 있다. 같은 등록 요청은 재시도해도 하나의 Inquiry/Action으로 처리한다. 실제 저장 여부가 불확실한 경우 이력 확인 후 새 입력을 시작한다. Dashboard는 진행 문의의 미완료 Action만 표시하며 집계는 최대 100개씩 표시한 목록 기준이다. 문의 조회에는 종료된 문의도 포함하고 고객·프로젝트 필터와 100개 단위 페이지를 지원한다.

실제 DB 두 세션에서 Action/종료의 상호 행 잠금 대기를 확인하고 검사 변경을 ROLLBACK했다. 경합 후 커밋 순서별 결과, 토큰 만료 UI, Outlook 실제 수집, 제품검색·AI·배포는 아직 검증/개발이 남는다. 전체 MVP 완료가 아니다. 실제 발송에 따른 Waiting 상태 전환은 커뮤니케이션 단계에서 연결한다.

## 로컬 실행

제품 검색·문의 후보 연결도 구현했다. 사용자 선택 범위는 100G LR4/SR4 두 제품이다. **제품 DB의 실제 적용·권한 검증은 확인 대기**이며 현재 제품 검색 결과 검증은 격리 화면/단위 테스트다. 사양 조건 일치, 불일치, 근거 미확인을 구분하고 후보 선택 근거와 기록 당시 자료를 보존한다. 판매·최신본·Packing·가격·납기를 확정하지 않는다. 상세 절차는 docs/operations/2026-10-07-product-search.md를 따른다.

Node.js와 npm이 필요하다. 패키지 버전은 package-lock.json으로 고정한다.

```powershell
npm ci --ignore-scripts
npm run build
npm run dev
```

브라우저에서 http://127.0.0.1:4317 을 연다. 서버는 이 PC의 loopback 주소만 사용하며 외부 공개 배포가 아니다.

`.env.example`을 참고해 `.env`에 새 프로젝트 URL과 **publishable 공개 키만** 설정한다. 비밀번호, secret/service_role 키, AI 키는 넣지 않는다. 잘못된 키나 기존 프로젝트 URL이면 연결을 차단한다. `.env`와 개인 notes는 Git에서 제외한다.

로그인 세션은 브라우저 메모리에만 유지한다. 새로고침 또는 새 탭에서는 다시 로그인한다. 실제 비밀번호는 사용자 직접 입력하며 앱 로그와 파일에 남기지 않는다.

## DB 접근 검증

기초 구조: db/schema-basic.sql. 처음 구성된 뒤 다시 실행하면 테이블 충돌이 나므로 자동 반복 적용하지 않는다. 이 SQL은 Supabase migration history 기록이 아니다.

db/verify-login-access.sql은 가상 사용자·고객·문의·Action·연락처·프로젝트 및 임시 권한을 하나의 트랜잭션에서 검증하고 전부 ROLLBACK한다. 실제 사용자 로그인 성공 검증과 구분한다.

db/enable-login-read.sql은 지정 계정 허용과 SELECT 권한 적용을 위한 별도 최종 작업이다. 2026-10-06 사용자 최종 확인 후 적용했다. INSERT/UPDATE/DELETE를 허용하지 않으며 anon 조회 권한도 없다. db/verify-login-read.sql로 적용 후 상태와 테스트 데이터가 남지 않았는지 확인한다. 수정 기능을 구현할 때 정책과 DB 업무 규칙을 다시 검증한다.

db/verify-basic-schema.sql은 초기의 클라이언트 권한 0개를 기대하는 **권한 개방 전 구조 검사**다. SELECT 적용 후에는 db/verify-login-read.sql을 사용한다.

기본 업무 쓰기: db/basic-work-write.sql은 원문·revision·종료 규칙과 SECURITY INVOKER RPC를 정의한다. db/enable-basic-write.sql은 기존 허용 계정의 소유자 RLS를 유지하면서 authenticated INSERT/UPDATE와 업무 RPC EXECUTE만 추가한다. DELETE, sales_access 변경, anon 접근은 허용하지 않는다. 적용 대상은 새 프로젝트 `glscckjmlwvxilzneqdf`뿐이다.

`node tools/prepare-write-validation.mjs`는 지정 D outputs에 최종 적용 SQL과 ROLLBACK 검증 SQL을 생성한다. ROLLBACK SQL은 규칙·임시 권한·합성 데이터 검증을 같은 트랜잭션에서 수행하고 모두 되돌린다. 최종 적용 SQL은 **권한 적용 확인 후** 실행한다. 적용 후에는 db/verify-basic-write.sql을 사용한다. 과거 db/verify-login-read.sql은 읽기 전용 단계의 스냅샷 검사이므로 쓰기 적용 후 실행하면 의도대로 실패한다.

기본 업무 최종 SQL은 이미 적용됐다. 컬럼·제약·함수 생성이 포함되므로 반복 적용하지 않는다. 보안 점검 중 발견한 관리용 rls_auto_enable 함수의 클라이언트 EXECUTE는 db/harden-rls-event-access.sql로 제한했다. ensure_rls 이벤트 트리거와 자동 RLS 동작은 유지·검증했다. Security Advisor는 오류 0건, 유출 비밀번호 보호 비활성 경고 1건이다. 해당 보호는 유료 플랜 기능이며 무료 사용 조건을 유지했다.

## 검증

```powershell
npm test
npm run build
python -m unittest discover -s tests -v
```

API 단위 테스트는 네트워크 응답을 가상으로 제공한다. 실제 RLS 테스트 및 사용자 직접 로그인 확인으로 보완한다. 작업 기록은 docs/operations에 보관한다.

`node tools/ui-fixture-server.mjs`는 `127.0.0.1:4318`에서 실제 화면 소스와 가상 Auth/DB 응답을 사용해 UI를 검증한다. Supabase에 연결하지 않으며 테스트 빌드는 D outputs/ui-fixture에 저장한다. 운영 빌드(`npm run build`)는 가상 SDK를 사용하지 않는다. fixture의 테스트 계정과 내용을 실제 자료 검증으로 보고하지 않는다.

src/worker.mjs는 향후 Workers 연결을 위한 동일 API 핸들러다. 실제 Cloudflare 설정·ASSETS binding·HTTPS 배포 검증은 아직 하지 않았다.

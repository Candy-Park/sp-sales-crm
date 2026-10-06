# Source Photonics sales CRM

1인 영업 CRM의 MVP. 개발 범위와 검수 기준은 [개발계획서](docs/development-plan.md)를 따른다.

## 현재 가능한 기능

로컬 로그인 화면, Supabase Auth 인증, 허용 계정 확인, 본인 미완료 Action·진행 문의 조회. 원문 출력에는 HTML 삽입을 사용하지 않는다. 데이터 조회 실패는 오류로 표시하며 0건으로 바꾸지 않는다. Dashboard 집계는 최대 100개씩 표시한 목록 기준이고 제한에 도달하면 화면에 알린다.

문의 등록·Action 수정·종료 트랜잭션, Outlook 실제 수집, 제품검색·AI·배포는 후속 개발이다. 이 상태를 전체 MVP 완료로 취급하지 않는다.

## 로컬 실행

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

## 검증

```powershell
npm test
npm run build
python -m unittest discover -s tests -v
```

API 단위 테스트는 네트워크 응답을 가상으로 제공한다. 실제 RLS 테스트 및 사용자 직접 로그인 확인으로 보완한다. 작업 기록은 docs/operations에 보관한다.

src/worker.mjs는 향후 Workers 연결을 위한 동일 API 핸들러다. 실제 Cloudflare 설정·ASSETS binding·HTTPS 배포 검증은 아직 하지 않았다.

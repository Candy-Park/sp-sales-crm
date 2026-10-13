# 무료 외부 CRM 전환 실행 계획

> Agent execution: superpowers:executing-plans로 현재 대화에서 순서대로 수행한다. 별도 에이전트 없이 진행한다. 각 완료 항목은 새 검증 근거로 체크한다.

**Goal:** 무료 workers.dev 주소에서 PC 종료 후에도 같은 계정의 문의·Action·기한·제품/회신·메모를 조회·수정하고, Outlook 수집/검토 결과를 인증된 방식으로 동기화한다.

**Architecture:** Cloudflare Worker가 정적 화면과 인증된API를 제공하고 기존 Supabase가 업무/메모/검토 정보를 저장한다. Windows PC의 수집은 별도 Agent가 담당한다. 기존 로컬4327과 데이터는 유지한다.

**Stack:** 기존 Vanilla JS/Bootstrap/esbuild, Cloudflare Workers+Wrangler, 기존 Supabase Auth/PostgreSQL/RLS, Windows Node/Python/Classic Outlook.

**Spec:** [승인된 외부 전환 설계](remote-access-design.md).

## 전역 제약과 검토 초점

- 추가 유료플랜/VM/새도메인/AI API 호출 없이 Free로 진행한다. 도메인/DNS/메일 설정은 변경하지 않는다.
- 기존 인증계정/허용목록/owner_id·원문·필수업무/기한·로컬 메모·4327 운영을 보존한다.
- 공개 정적 번들/로그/Git에 실제 메일/메모·토큰/서비스키를 넣지 않는다. 설정은 publishable key와 필요한 배포 비밀을 구분한다.
- PC가 꺼졌을 때 새 수집 불가를 정확히 표시하며 빈목록/업무완료로 오인시키지 않는다.
- 같은 업무의 로컬/외부 편집 충돌, 응답 유실, 동기화 중단, 재실행 중복과 다른 소유자 자료를 검수한다.
- Workers Free CPU/요청·Supabase Free 저장/전송 한도에 맞춘다. 무료 한도 초과 시 유료전환 대신 원인을 보고한다.

## 작업1 — 클라우드 보존 구조와 소유자 검증

**Files:** db/remote-access.sql, db/test-remote-access.sql, tests/remote-access-db.test.mjs, src/remote-input.mjs.

**Interface:** 소유자별 검토 snapshot·동기화 영수증/실행 요청과 메모/이력·멱등 요청RPC. 기존 문의/Action/메시지는 기존API로 읽고 쓴다. 요청 owner는 verified Auth에서 결정한다.

- [ ] 합성 DB 검사부터 작성: 익명/타인 차단, 자신의 조회·쓰기, 오래된 revision/응답 유실 후 중복 요청, 메모 편집/완료/원문 보존.
- [ ] 실패를 확인한 뒤 추가 테이블/RLS·RPC·입력 검증을 구현한다. 기존 테이블 삭제/재생성·운영 행 수정 없음.
- [ ] 기존 프로젝트 SQL과 함께 격리PGlite/PostgreSQL에서 실제 트랜잭션·RLS/정합성 검수한다.
- [ ] 공개 설정/서비스키·오래된 동기화/과대본문을 거부하는 검사와 전체기능 회귀를 통과한다.
- [ ] 운영 스키마는 무료플랜/기존건수·권한을 먼저 대조하고, 새 변경분만 적용·사후검증한다. 설정사본/핵심 자료 보존을 확인하고 새 dump를 반복 생성하지 않는다.
- [ ] 작업/개발보고에 범위·검증·제한과 선별 커밋을 기록한다.

## 작업2 — PC 없이 동작하는 인증API

**Files:** src/remote-api.mjs, src/remote-followups.mjs, src/remote-memos.mjs, src/worker.mjs 또는 src/remote-worker.mjs, tests/remote-api.test.mjs, tests/remote-followups.test.mjs.

**Interface:** /api/crm/config·기본업무 경로는 기존handleApi 사용. /api/crm/followups·소유자별 검토/메일 조회·/api/memos와동기화 경로는 신규어댑터로 처리한다. native JSON 형태와 local-memos UI 응답 형태를 유지한다.

- [ ] 실패 검사 작성: 모든 사적조회 로그인필수, 잘못된Origin/메서드/본문, 타인ID, 오래된 snapshot이 최신Action/종료를 덮지 않음.
- [ ] Auth /user·sales_access 확인과 기존RLS로 권한검사를 수행한다. 사용자 metadata/owner_id를 권한근거로 쓰지 않는다.
- [ ] 클라우드 snapshot에서 검토/메일관측을 읽고 현재Inquiry/Action을 DB에서 다시 합쳐 홈을 반환한다.
- [ ] 외부 ‘지금 메일 확인’은 실행 요청/대기/PC미연결 상태를 반환한다. 실제 수집이 되기 전 성공/최신으로 보고하지 않는다.
- [ ] 메모RPC에 기존 요청Id/revision 형식을 연결하고 uncertain save/충돌·타인차단을검수한다.
- [ ] 인증/원문/제품/회신/로그아웃 회귀와 익명 static/API분리를 확인한 뒤 선별커밋한다.

## 작업3 — 최신 업무 화면과 안전한 외부 진입점

**Files:** web/remote-app.mjs, tools/build-remote.mjs, tests/remote-ui.test.mjs, tests/fixtures/remote-browser.mjs. 기존web/index.html·style.css·업무/메모 UI 모듈 재사용.

**Interface:** 같은 메뉴와 업무 상세/메모 UI, API 요청의유효세션과로그아웃시 generation 보존. 기존PC용 handling-preview 번들을 외부로 복사해 익명 업무자료가 노출되게 하지 않는다.

- [ ] 로그인 전/로그아웃 후 사적DOM비움·지연응답 차단, 홈/고객/HQ/등록/이력/메모·3일 기한·연장 검사를먼저작성한다.
- [ ] 새로운 외부 진입점을 만들되 최신Frosted/Pretendard·업무/카드/메뉴구조를 보존한다.
- [ ] 외부 메모를 인증API에연결하고 PC/메일상태·마지막동기화시각·오래된관측자료를 표시한다.
- [ ] 상세의 제품/회신/원문·Action/종료 규칙을 재사용하고 UI이동만으로 저장하지 않는다.
- [ ] 합성Chrome에서 전체로그인/저장/재조회·중복/401·메모입력 보존을확인한다. 로컬4327 동작을회귀검수한다.
- [ ] 외부 빌드에실데이터/개인경로/비밀없음, 폰트/CSP/HTTPS모드·좁은 화면 확인후커밋한다.

## 작업4 — Windows 수집·관측·메모 최초 대조와 동기화

**Files:** tools/remote-agent.mjs, tools/remote-sync.mjs, src/remote-sync.mjs, tests/remote-sync.test.mjs. 기존Outlook/담당규칙/재개영수증 모듈 재사용.

**Interface:** verified owner·requestId·revision/hash 기반 snapshot/관측 동기화. 별도 클라우드 실행요청을 PC에서 처리하고 실제 결과를 반영한다. 토큰은 명령행/본문로그에 노출하지 않는다.

- [ ] 부분 저장/중단/동일요청 재시도, 수정충돌·owner변경·Outlook미실행·시간대/평일조건 검사부터작성한다.
- [ ] 현재 approved 담당자료와native업무의 관계를 확인해 최소검토/관측 자료를 동기화한다. 보안원문/보류자료는 제외하고기존 원문/캐시를보존한다.
- [ ] 로컬메모 최초반영은 식별자/내용/완료/기한/버전/건수를 대조하며삭제하지 않는다. 외부수정과로컬수정 충돌을 숨기지 않는다.
- [ ] Agent의실행·연결/미연결 표시, 평일10~18 정각과 수동 요청을구현한다. 전역OS작업/인증정보영구보관을자동추가하지 않는다.
- [ ] 실제PC연결중단→클라우드조회/수정 유지→PC복귀/대조를 확인하고메일발송/실고객상태임의변경을하지 않는다.
- [ ] 실자료/인증/영수증은 Git 밖에두고관련소스·검증기록만커밋한다.

## 작업5 — 무료 계정 배포와 외부 실제 검수

**Files:** wrangler.jsonc, tools/deploy-remote.mjs(필요시), package.json·lockfile, .gitignore, tests/remote-worker.test.mjs.

- [ ] Cloudflare Workers·기존Supabase가Free인지계정화면으로확인한다. 결제/유료옵션·새프로젝트 없음.
- [ ] 공식npm Wrangler의버전을확인하고 필요한개발의존성/배포설정만추가한다. .wrangler/·비밀/개인설정을Git제외한다.
- [ ] CLI OAuth등새권한승인은 사용자가직접확인한다. 계정로그인을CLI인증완료로간주하지 않는다.
- [ ] 실제Worker/static assets를workers.dev에배포하고생성된주소를확인한다. 관리키는클라이언트에제공하지 않는다.
- [ ] 익명/미허용/401/다른Origin 차단·정상로그인·실업무읽기·허용된가상업무쓰기/재조회·메모·제품/회신·재접속검수한다.
- [ ] PC전용연결을중단한상태에서저장업무조회/수정/재조회가가능하고PC미연결안내가맞는지증거를남긴다.
- [ ] 원격배포주소/실제검수/한계를기록하고최신커밋의공개GitHub반영을확인한다.

## 복원과 완료 판정

운영데이터를삭제하지않고로컬4327을유지한다. 새Worker문제는이전검증된배포로돌리거나접속진입을차단하며DB스키마/기존행을임의되돌리지않는다. 새동기화표와원문/메모는별도보존한다. 기능코드복원은관련커밋일반revert이며공개이력을강제로고치지않는다.

**완료:** 실제외부주소,로그인/허용계정권한,PC연결중단상태의업무조회/수정·메모재조회,PC복귀동기화와기존로컬기능보존검수까지마친다. Cloudflare로그인또는정적페이지배포만으로외부CRM완료를주장하지않는다.

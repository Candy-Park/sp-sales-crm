# 일반 메모 3건 보존·연결 최소 구현 계획

> 실행자 안내: 사용자 실행 승인 뒤 이 계획을 순서대로 수행한다. 인라인 실행 시 `superpowers:executing-plans`를 적용한다. 아래 체크박스는 아직 실행하지 않은 구현·검수 작업이다.

**Goal:** Source Photonics CRM(B)의 일반 메모 3건을 원본 그대로 보존하고 sp-sales-crm(A)에서 사용한다. 그중 전화 메모는 문의와 연결하지 않는 독립 할 일로 둔다.

**Architecture:** A 기존 클라우드 메모를 사용하고, 출처·원본 스냅샷과 독립 할 일 여부만 추가한다. B 원본은 그대로 두며 3건을 한 번 선별 복사한다. 양방향 동기화·상시 B API 연결은 만들지 않는다.

**Tech Stack:** 현재 JS 웹/API, Supabase PostgreSQL·기존 메모 RPC, Node test/PGlite를 유지한다. 새 프레임워크·서비스·유료 API는 추가하지 않는다.

**Spec:** 사용자 2026-10-21 요청, [기획서](../development-plan.md)의 메모 보존 확정 요구사항, [원격 대조 작업 기록](../operations/2026-10-21-crm-readonly-audit.md). 실제 선택 ID·계정과 데이터 근거는 D 비공개 산출물에 보관한다.

- 기획 원본 revision 3 / 작성일 2026-10-21 / 상태: **검토용 구현 계획, 실행 미승인**.
- 이전 [전체 통합안](crm-integration-plan.md)은 조사 이력으로 유지한다. 이번 실행 후보는 이 문서의 좁은 범위이며 전체 통합안의 상시 연결·문의 병합을 동시에 구현하지 않는다.

## 1. 확정 범위와 작성자 선택

| 대상 | A에서의 처리 | B와 기존 기록 |
|---|---|---|
| B-M02 전화 메모 | **‘다산 전화’ 그대로, 업무 분류, 미완료·기한 없음인 독립 할 일**. 홈에서 열고 완료/완료 취소 가능 | B 원본 유지. 다산 문의 2건, 고객·프로젝트·Inquiry·sales_action과 연결하지 않음 |
| B-M04 일반 업무 메모 | 기존 본문·업무 분류·기한 없음·미완료로 메모에 표시 | B 원본 유지. 별도 영수증 모듈이나 할 일로 자동 변환하지 않음 |
| B-M01 개인 메모 | 원문·개인 분류·기한 없음·미완료로 개인 메모에 표시 | B 원본 유지. 본문을 공개 문서·Git에 넣지 않음 |
| B 검수 기록 | 가져오지 않음 | 수정·삭제·숨김·완료 처리 없이 유지 |
| B 기본 로컬 3건 | 가져오지 않음 | 파일·행·revision·요청 기록 그대로 유지 |
| A 기존 문의·Action·메모·검수 기록 | 기존 상태·기한·원문·이력 유지 | 일괄 정리·분류 변경 안 함 |

세 메모 모두 새 기한을 추정하지 않는다. 개인 메모와 다른 업무 메모를 홈의 독립 할 일에 자동 추가하지 않는다. A에서 완료해도 B 원본은 완료 처리하지 않는다.

**작성자 선택(계획 승인 전 제안):** 출처는 A 메모의 추가 열 1개에 넣고, 홈 표시용 boolean 1개를 추가한다. 문의를 강제로 생성하거나 독립 Task 테이블을 새로 만들지 않는다. ‘별도 할 일’은 기존 메모 완료 기능을 갖는 독립 항목이며 Inquiry 종속 Action이 아니다.

## 2. 최소 데이터·인터페이스 계약

현재 A `sales_remote_memo`는 본문·분류·기한·완료·revision을 이미 저장하고 `sales_remote_memo_write`로 수정/재시도를 처리한다. `web/local-memos.mjs`는 클라우드/로컬이 공유한다. 실제 코드에는 홈에 메모 할 일을 모으는 연결이 없어 그 부분만 추가해야 한다.

### 저장 변경 제안

- `sales_remote_memo.origin jsonb NULL`: B project ref, B owner UUID, entity=`crm_memo`, 원본 memo UUID, 원본 revision, 원본 생성/수정 시각, 원본 스냅샷, 스냅샷 SHA256, `capturedAt`을 보관한다. A ID·revision·생성/수정 시각과 구분한다.
- `sales_remote_memo.home_task boolean NOT NULL DEFAULT false`: 전화 메모만 true. 기존 행은 false로 유지한다.
- 원본 스냅샷은 B의 `id, owner_id, content, category, due_date, completed_at, revision, created_at, updated_at` 9개 필드다. `origin.snapshot`은 키를 정렬해 직렬화한 canonical JSON **문자열**로 저장하고, SHA256은 그 정확한 UTF-8 바이트로 계산한다. 서버는 문자열을 JSON으로 파싱해 필드/소스 identity 일치를 검사하고 문자열 바이트 해시도 재검산한다. JSONB 재직렬화의 공백 차이를 해시 충돌로 오인하지 않는다. 스냅샷은 원문을 보존하며 현재 화면용 본문 정리와 분리한다.
- 부분 unique index: `(A owner_id, origin.projectRef, origin.ownerId, origin.entity, origin.id)`이며 origin이 있는 행에만 적용한다. 다른 A 소유자의 원본 참조를 읽거나 쓰지 못한다.
- `origin`과 `home_task`는 가져오기 생성 시만 받는다. 이번 범위의 일반 PATCH로 변경하지 못한다. 기존 메모 PATCH의 본문/분류/기한/완료와 revision 검사는 그대로 사용한다.
- API 응답에는 `origin`과 `homeTask`를 추가한다. 기존 행·로컬 모드는 null/false로 해석하여 예전 저장 형식을 보존한다. 새 열을 쓰는 변경은 additive SQL 한 파일로 분리하고 기존 `db/remote-access.sql`을 고쳐 재실행하지 않는다.

### 원본 보존·재시도

기존 POST `/api/memos`의 `{requestId,input}` 계약을 확장해 가져오기 생성에만 `input.origin`, `input.homeTask`를 허용한다. 기존 일반 생성/수정 호출은 그대로 유효하다. RPC는 기존 소유자 확인·잠금·영수증·이력 절차 안에서 다음을 보장해야 한다.

1. 같은 원본 identity와 같은 스냅샷 hash로 다시 가져오면 **현재 A 메모를 반환하고 추가 생성 0건**. 요청 UUID가 달라도 적용한다.
2. A에서 본문/완료를 수정한 뒤 재실행해도 현재 값을 되돌리지 않는다. 최초 RPC 응답 영수증에 있는 오래된 메모를 현재 값으로 오인하지 않는다.
3. 같은 원본 identity인데 hash가 달라지면 409로 멈추고 재검토한다. B 원본 변경을 A에 자동 덮어쓰지 않는다.
4. 동일 요청 UUID에 다른 입력은 기존대로 충돌. 한 메모의 생성·원본 정보·이력·영수증은 한 DB 트랜잭션으로 처리한다.
5. 세 건 전체가 원자적으로 저장된다고 주장하지 않는다. 미리 세 건을 모두 검증한 뒤 순차 저장하며, 중간 실패 시 성공/대기 항목을 표시한다. 다음 시도는 원본 identity로 기존 생성분을 찾아 누락분만 이어간다. 완료 판정은 마지막 서버 재조회에서 세 개의 1:1 매핑을 확인한 뒤 한다.

UI의 가져오기 입력 파일은 실행 직전 B에서 읽기 전용으로 다시 확인한 **정확한 세 ID**만 포함한다. D의 비공개 `selection-manifest.json`은 ID·계정·기대 revision을 정하는 선택 목록이며, 개인 본문을 생략한 조사 증거를 실제 가져오기 파일로 사용하지 않는다. 소스가 예상 revision과 다르면 새 미리보기를 만들기 전 저장하지 않는다. 가져오기 파일은 준비 단계의 원본 대조로 확인하며, 해시가 B의 서명/진본 인증을 대신한다고 주장하지 않는다. `homeTask=true`는 이 범위에서는 확인된 전화 메모 생성에만 사용한다.

현재 A/B의 허용 계정은 서로 다르다. 실행 때 실제 로그인된 A 계정을 대상 owner로 확인하고, B 원본 owner와 선택 ID를 대조한다. owner를 브라우저 입력 그대로 신뢰하거나 B 토큰을 A에 재사용하지 않는다. 기존 RPC가 SELECT 전용 테이블에 접근하기 위해 가진 좁은 definer 경계는 늘리지 않고, auth.uid/허용 계정 검사·PUBLIC/anon 실행 회수·고정 search_path를 유지·검증한다.

## 3. 화면·연결 동작

| 진입점 | 최소 동작 | 빈/오류/권한 상태 |
|---|---|---|
| P01 기존 메모 화면의 접힌 가져오기 영역 | 준비된 JSON 파일 선택 → 세 건의 분류/기한/원본/대상 계정 미리보기 → ‘3건 보존·연결’ → 건별 결과 | 다른 원본·검수·누락·추가 레코드·잘못된 해시/버전은 저장 전 거절. 파일 본문을 로그로 출력하지 않음 |
| P02 기존 메모 목록/수정 | 세 건의 현행 본문·개인/업무 분류, ‘가져온 메모’ 배지, ‘원본 정보’ 펼치기 | 원본 정보에는 가져온 시점임을 표시. A 수정 내용과 초기 스냅샷을 구분. B 장애와 무관하게 A 저장본 조회 가능 |
| P03 A 홈의 ‘독립 할 일 · 기한 없음’ | 전화 항목 한 개 → 메모 열기 또는 완료 체크. 완료 시 목록에서 빠지고 기존 완료 메모에서 조회/취소 | 다른 두 메모·검수 기록은 이 목록에 추가하지 않음. 저장 실패는 기존 상태·입력을 유지, 충돌 시 최신 재조회 |

B에는 확인된 개별 메모 deep link가 없다. ‘원본 정보’는 **A에 저장한 출처·원본 ID·스냅샷을 여는 기능**으로 구현한다. 선택적으로 ‘기존 CRM 열기’는 확인된 B 앱 기본 주소만 연다. 특정 메모로 곧바로 이동한다고 표시하지 않는다. 정확한 원문 메모 URL을 임의로 만들지 않는다.

홈 항목 key는 `memo:<A memo ID>`다. 같은 메모를 화면에서 두 번 집계하지 않는다. `homeTask=true && completedAt==null`을 독립 목록 조건으로 삼고, 문의 기반 today/overdue Action 숫자는 바꾸지 않는다. 기한 없음은 오늘 기한·기한 초과로 합산하지 않는다.

초기 전화 항목은 기한 없음이다. 사용자가 이후 기존 메모 수정에서 직접 기한을 정하면 홈에도 해당 날짜와 서울 기준 오늘/초과/예정 표시를 반영한다. 계속 ‘기한 없음’이라고 표시하거나 자동으로 날짜를 지우지 않는다. 독립 메모 집계와 기존 Inquiry Action 숫자는 계속 구분한다.

메모 수정·완료/취소는 기존 API 한 번으로 처리한다. 가져온 직후, 수정/완료/새로고침 후 홈과 메모 목록에 같은 최신 revision을 반영한다. 계정 변경/로그아웃은 가져오기 미리보기·파일 본문·홈·원본 펼침을 함께 비운다. local 모드에 원격 원본·기능을 노출하지 않는다.

완료 요청의 응답이 유실되면 결과 미확인을 표시하고 서버를 재조회한 뒤 다음 조작을 허용한다. 결과 확인 없이 완료→미완료의 반대 토글을 자동 재시도하지 않는다.

## 4. 구현 작업 — 순서대로 승인 후 수행

### 작업 1: 출처 보존·중복 없는 저장 기반 (M01, M02)

**Files:** Create `src/memo-import.mjs`, `db/memo-origin.sql`, `tests/memo-import.test.mjs`, `tests/memo-origin-db.test.mjs`; Modify `src/remote-input.mjs`, `src/remote-api.mjs`, 관련 기존 `tests/remote-api.test.mjs`.

**Interfaces:** `validateMemoImport(manifest, expectedSelection, targetOwnerId) -> normalizedRecords[3]`; 응답 메모에 `origin|null`, `homeTask:boolean`. 서버 owner는 기존 인증에서 결정한다. 원본 identity와 canonical snapshot hash는 이 단계에서 고정한다.

- [ ] 합성 원본으로 원본 스냅샷 보존·동일 원본 중복·변경 hash 충돌·다른 owner 거절·일반 메모 하위 호환 테스트를 먼저 작성한다.
- [ ] `node --test tests/memo-import.test.mjs tests/memo-origin-db.test.mjs tests/remote-api.test.mjs`에서 미구현 실패를 확인한다.
- [ ] 기존 `tests/remote-access-db.test.mjs`의 PGlite auth/권한 fixture를 재사용해 추가 열/index와 RPC 확장, 입력검증·응답 매핑만 구현한다. 운영에 SQL을 적용하지 않는다.
- [ ] 같은 테스트와 `tests/remote-access-db.test.mjs`를 실행한다. 중간 예외에서 origin만 남거나 메모만 남지 않음을 확인하고 선별 커밋한다.

### 작업 2: 선별 가져오기·원본 정보 (M01~M03)

**Files:** Create `web/memo-import.mjs`, `tests/memo-import-ui.test.mjs`; Modify `web/local-memos.mjs`, `web/remote-app.mjs`, `tests/remote-memo-ui.test.mjs`.

**Interfaces:** `initMemoImport({root,api,getUser,selection,onImported}) -> {reset}`. `selection`은 로그인된 세션에 파일로만 주입하며 소스에 개인 ID/본문을 하드코딩하지 않는다. `onImported`에서 기존 메모 load를 수행한다. `initMemos`에 `onChanged(items)`, `open(id)`, `toggle(id)`를 더하되 기존 반환값·일반 폼 동작은 유지한다.

`getUser`는 `web/remote-app.mjs`에서 기존 onConnected/onDisconnected 값으로 유지하는 새 closure다. connection에 이미 존재하는 메서드라고 가정하지 않는다. 미주입 onChanged는 no-op으로 두어 공유 로컬 화면을 보존한다.

- [ ] 정확히 세 ID만 허용, 소스/대상 계정 불일치, 개인 본문 텍스트 이스케이프, 응답 유실 재시도, A 수정 후 재가져오기 보존, 1/3 저장 후 재개, 로그아웃 후 파일 내용 폐기 테스트를 작성한다.
- [ ] `node --test tests/memo-import-ui.test.mjs tests/remote-memo-ui.test.mjs`로 실패를 확인하고 작은 접힘 영역·건별 상태·원본 정보만 구현한다.
- [ ] 같은 테스트 통과와 공유 local 모드 회귀(`tests/local-memos.test.mjs`, `tests/local-memo-api.test.mjs`)를 확인한다. 원문을 innerHTML·URL 파라미터·브라우저 영구 저장소에 넣지 않고 선별 커밋한다.

### 작업 3: 전화 메모의 독립 할 일 표시 (M04)

**Files:** Create `web/memo-task-agenda.mjs`, `tests/memo-task-agenda.test.mjs`; Modify `web/remote-app.mjs`, 필요 시 `web/style.css`의 기존 클래스만 보완.

**Interfaces:** `initMemoTaskAgenda({root,onOpen,onToggle}) -> {setItems,reset}`. 기존 `initMemos.onChanged`로 같은 메모 데이터를 받는다. `onOpen`은 기존 메모 페이지를 열고 `memos.open(id)`, `onToggle`은 `memos.toggle(id)`를 호출한다. 새 Inquiry/Action 저장 호출은 없다.

- [ ] 미완료 전화 항목 1개·다른 두 메모 제외·초기 기한 없음과 사용자 기한 변경 반영·완료/취소·응답 유실 재조회·401/409/통신 실패·로그아웃 초기화·중복 load 재집계 방지 테스트를 작성한다.
- [ ] `node --test tests/memo-task-agenda.test.mjs tests/remote-memo-ui.test.mjs`의 실패 후 위 인터페이스로 작은 홈 영역만 구현한다.
- [ ] 기존 Inquiry·Action 숫자와 메모 개인/업무 필터가 유지됨을 검증하고 선별 커밋한다.

### 작업 4: 실제 세 건 연결·운영 검수 (M05, 별도 실행 승인 범위)

**Files:** 코드 추가 없이 D `sources/memo-minimal-<실행일>/`에 B 읽기 스냅샷·A 기존 메모/이력 백업·선택 manifest, D outputs에 실제 검수 결과. 운영 기록은 기존 docs/operations에 이어 쓴다.

- [ ] 코드·합성 테스트·기존 원격 빌드 검사를 마친 후보를 먼저 사용자에게 제시한다. 실제 DB 적용/배포/세 건 쓰기는 사용자 실행 승인 범위에 포함되어야 한다.
- [ ] 실행 직전 실제 A/B 프로젝트·계정·선택 세 ID·원본 revision/내용·개인 분류·A 기존 메모를 읽기 재확인한다. B 전체 업무/메모와 로컬 DB 보존 기준을 D에 백업/해시로 남기고 격리 복원 확인을 한다.
- [ ] 승인된 A에 additive SQL만 적용하고 인증된 합성/권한 검수, 기존 화면 호환을 확인한 뒤 앱을 반영한다. B DB·코드·계정은 쓰지 않는다.
- [ ] 세 건을 미리보기 후 연결한다. 가져오기 이후 새 세션 GET에서 정확히 원본 세 개→A 세 개 매핑, 본문·분류·기한·원본 스냅샷을 확인한다. 같은 파일 재실행 추가 생성 0건을 확인한다.
- [ ] 실제 메모를 임의로 완료/변경하며 검수하지 않는다. 완료/충돌 검수는 격리된 합성 자료로 수행하고, 사용자의 실제 완료 확인은 사용자 행동으로 남긴다.
- [ ] B 선택 세 건과 검수 기록, 기본 로컬 3건, A 기존 문의/Action/메모/검수 기록이 보존되었는지 비교한다. 소스가 외부에서 바뀌었으면 원인 구분 전 보존 합격을 선언하지 않는다.

빌드는 기존 `npm run build:remote` 흐름을 따르되 납품/대용량 검수 출력은 실행 전에 D로 지정한다. 현 스크립트 기본 dist-remote는 빌드 작업 폴더이며 최종 납품으로 쓰지 않는다. 자동 생성이 불가피하면 D로 복사 후 파일 수·크기·해시를 검증한다. 전체 테스트는 `npm test`를 한 번 실행하고 새 실패/변경이 없으면 반복하지 않는다. 최신 Supabase 문서·CLI 사용법은 실제 구현 단계에서 확인한다.

## 5. 합격 기준 — 아직 실행하지 않음

| ID | 입력/조건 | 기대 결과 |
|---|---|---|
| T01 | 선택 목록·원본 최신값·대상 계정 미리보기 | 정확히 3건. 다른 원본·검수·로컬 데이터는 가져오지 않음 |
| T02 | 정상 가져오기 후 새 세션 | A에 세 건, 본문/분류/미완료/기한 없음 보존. B 원본 불변 |
| T03 | 같은 입력의 응답 유실·다른 요청 UUID 재시도 | 원본별 A 메모 하나. 생성/이력/영수증의 부분 저장 없음 |
| T04 | 1건 성공 뒤 네트워크 실패·재시작 | 성공/대기 표시, 기존 생성분을 찾아 누락분만 연결 |
| T05 | A 본문 또는 완료 수정 뒤 재가져오기 | 수정 보존·현재 revision 반환. 원본 스냅샷은 최초 내용 유지 |
| T06 | 동일 소스 ID·다른 hash, 타 owner·잘못된 분류/날짜/원문 | 409 또는 400/403, 잘못된 쓰기 0건. 강제 덮어쓰기 없음 |
| T07 | 전화 항목 홈 조회/완료/취소 | 독립 항목 한 개. 고객·Inquiry·Action 생성/연결 없음. 완료는 기존 메모에 저장 |
| T08 | 초기 기한 없음·사용자 기한 변경·개인/다른 업무 메모·검수 기록 | 초기 today/overdue 임의 합산 없음. 사용자가 정한 날짜는 홈에 반영하고 나머지 두 건은 메모 분류에 존재 |
| T09 | 원본 정보·B 미연결 | 출처 ID/시각/스냅샷 확인 가능. 없는 deep link를 표시하지 않음 |
| T10 | 로그아웃·권한 철회·401·409, 모바일 390px | 파일 본문·원본 정보·홈 데이터 제거 또는 잠금, 입력/오류 처리 유지·가로 넘침 없음 |
| T11 | 변경 전후 기준 자료 대조 | B 검수·로컬 3건과 A 기존 기록이 그대로. 가져온 새 세 건 외 임의 상태 변경 없음 |

RLS/다른 계정 차단·새 세션·모바일을 확인한 범위만 기록한다. 구조 검사나 합성 테스트 통과를 실제 세 건 연결 완료로 보고하지 않는다.

## 6. 복원·한계·다음 단계

배포 문제가 생기면 이전 A 화면/API로 복귀할 수 있게 추가 열은 기존 코드와 호환되게 둔다. 이미 연결된 세 메모는 보존하고 숨겨진 원본 메타데이터도 삭제하지 않는다. 연결 재시도는 같은 source identity로 재개한다. 사용자 A 수정이나 B 변경을 되돌리지 않는다. 데이터 제거/DB rollback은 이 계획에 포함하지 않는다.

B 원본은 가져온 시점의 스냅샷으로 연결한다. 실행 전 최신값 재확인 뒤 B가 나중에 바뀌는 것을 실시간 감지하거나 두 DB를 동시에 잠그지 않는다. 이 한계를 화면에 표시한다. 기존 로컬 PC용 A 메모 DB나 B 로컬 3건을 함께 이전하지 않는다.

다음 단계는 이 최소 계획의 검토와 실행 범위 승인이다. 승인 전에는 합성 구현·운영 SQL·데이터 복사·배포 모두 시작하지 않는다. 기록 보존 요청은 이번 계획의 확정 제약이며 현재 원본을 편집/정리할 허가는 아니다.

# 100G 두 제품 검색·문의 후보 연결

승인된 개발계획서 제품 검색 단계. 사용자가 초기 범위를 정리된 두 제품으로 먼저 검증하도록 선택했다. 기준 커밋 e6b19f4, 브랜치 codex/login-access, 원격 없음. 기존 PC CRM·Supabase sp-crm·원본 PDF·Auth·의존성·활성 경로를 보존했다. 제품의 실제 Supabase 적용은 아직 실행하지 않았다.

## 범위·결정·보존

- SPQ-CE-4LQ-CB (LR4), SPQ-CE-4SQ-CA (SR4)만 사용한다. 원본 해시를 읽고 파일명·문서번호·revision·자료일·페이지/표 근거를 가져오기 미리보기에 넣었다. PDF 원본·개인 원본 경로를 Supabase나 Git에 올리지 않는다.
- 제품군 100G와 aggregate 103.125 Gbps, SMF·OM3·OM4의 거리 최저/최고, 케이스 동작 온도를 구분한다. LR4 파장을 단일 1310nm로 바꾸지 않으며 SR4 Features nominal 850nm를 Table Typical로 채우지 않는다.
- 검색 필터는 P/N·제품명, 제품군 속도, Form Factor, 매체·거리(m), 동작 온도(°C), 출력 파장(nm), Packing 요구다. 일치/불일치/미확인 근거를 비교한다. 검색·후보 기록으로 문의 상태를 자동 변경하지 않는다. AI 요구사양 추출은 별도 미구현이다.
- 판매 상태·최신본 여부·가격·납기·PLM·HQ 확정일·Packing은 미확인이다. 자료 검토일은 HQ 확인일과 다르다. Datasheet로 Packing 요청이 해결됐다고 표시하지 않는다.
- 문의 상세에 비교와 이력을 둔다. 사용자 선택 상태(검토 후보/사용자 선택/HQ 확인 필요/검토 제외)와 근거를 기록한다. 복수 P/N 선택을 허용한다. 각 P/N의 가장 위 기록이 최신 판단이며 이전 기록을 보존한다. 선택은 판매·공급·HQ 확정이 아니다.
- 버전별 제품 행과 batch UUID를 고정하고 catalogue는 클라이언트 읽기 전용이다. 후보 이력은 append-only이며 당시 사양·출처·해시·검토일을 DB trigger가 복사한다. client owner/snapshot을 거부한다. UUID 재시도는 중복을 막고 변경된 입력은 충돌로 알린다.
- 후보 추가와 종료는 같은 Inquiry를 잠근다. Closed 후 추가와 기존 검토 이력 수정/삭제를 차단한다. 실제 두 세션의 제품 후보/종료 경합은 아직 미검증이다.
- 잘못된 batch는 의존성과 기록을 확인해 enabled=false 처리안을 준비한다. 자동 삭제·권한 복원·과거 사양 덮어쓰기는 하지 않는다. 다른 batch 재가져오기는 새 UUID/버전·별도 미리보기가 필요하다.

## 변경 파일

src/products.mjs·api.mjs: 필터/입력, 매 요청 Auth·허용목록·owner 확인과 catalogue/후보 이력 API. web/products.mjs·workspace.mjs·index.html·style.css: 검색·근거·이력·로그아웃 정리. db/product-search.sql: RLS·invoker RPC·snapshot/Closed guard. db/test-product-body.sql·verify-product-search.sql: ROLLBACK/사후 검사. tools/prepare-products.mjs: 두 원본 hash·검증 미리보기·정확한 적용 SQL. tools/ui-fixture-server.mjs: 격리 제품 응답. tests/products.test.mjs·product-ui.test.mjs: 도메인/API/비동기 화면 검증.

제품 내용과 초기 정리 JSON은 D outputs에만 둔다. 운영 번들에 제품 원본/가상 SDK를 넣지 않는다. 새 테이블 적용 대기로 기존 상세 API가 실패하지 않도록 후보 이력은 별도 API로 조회한다. DB 실패를 제품 0건으로 표시하지 않는다. fixture는 미리보기가 없으면 제품 빈 목록으로 기본 업무 검증을 유지한다.

## 실행한 검증과 한계

- 신규 검색/API의 기능 부재 실패를 확인한 뒤 구현했다. LR4 SMF 10km, SR4 OM4 100m, OM3 100m 불일치, 최저 거리, -40–85°C 불일치, 미확인/Packing, 잘못된 필터·역전 온도·단위, Auth·owner/snapshot 위조 차단, 안전한 RPC와 실패 응답 검증.
- 연속 검색에서 오래된 결과가 덮어쓰는 실패를 재현했다. 검색 순번으로 최신 결과만 표시하도록 수정하고 RED→GREEN 확인. logout/reset 뒤 늦은 응답의 개인 화면 복원 차단도 검사했다. P/N만 입력한 조회가 사양 일치로 표시되던 문제도 재현·수정해 사양 조건 미입력으로 구분했다.
- 최종 npm test 45/45, npm run build, git diff --check 통과. 외부 네트워크는 가상 응답이다.
- 격리 브라우저: 합성 문의 → LR4 10km 비교 → 사용자 선택·근거 저장 → OM3 불일치 → OM4 일치 → Packing 확인 필요 → SR4 HQ 확인 필요 기록 → Closed → 두 후보 이력/원문 보존 및 종료 문의 검색의 새 기록 버튼 없음 확인. 실제 Supabase 제품 E2E와 구분한다.
- 원본 2개 해시와 2건 미리보기 생성. 새 제품 SQL·실제 DB ROLLBACK·사후 권한·Advisor·실제 로그인 제품 E2E는 아직 미실행이다. 확인 후 수행한다. 전체 MVP 완료가 아니다.
- 공식 [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)·[DB 함수](https://supabase.com/docs/guides/database/functions) 문서의 grants/정책·invoker 원칙을 확인했다. secret/service-role 키를 사용하지 않는다.

## 적용 확인 범위·다음 작업

새 glscckjmlwvxilzneqdf에 제품/검토 이력 테이블 2개·RLS·guard/RPC를 만들고 기존 지정 소유자의 제품 2건을 넣는다. authenticated에는 sales_product SELECT, sales_inquiry_product SELECT/INSERT, sales_link_product EXECUTE를 추가한다. owner_id와 기존 sales_access로 본인 자료만 접근한다. anon·새 사용자·제품 편집·검토 UPDATE/DELETE·허용목록 변경·기존 CRM·유료 전환·배포는 없다.

순서: products-rollback.sql 검사/ROLLBACK → 성공할 때만 products-apply.sql 지속 반영 → verify-product-search.sql → Security/Performance Advisor 및 실제 UI E2E. 실패한 검사 상태에서 지속 적용하지 않는다. browser의 권한 확대 실행 시점 확인 정책으로 구체적인 적용 직전에 사용자 확인을 받는다.

D:/AI/projects/sp-sales-crm/outputs/에 2026-10-07-products-preview.json, products-apply.sql, products-rollback.sql, products-manifest.json, 화면·검증/요약을 저장했다. 정확한 적용 해시와 로컬 커밋은 manifest/summary에 남긴다. push하지 않는다. 복원은 e6b19f4와 필요한 파일만 비교한다. DB에는 아직 되돌릴 제품 변경이 없다.

최종 격리 새 세션에서도 P/N 단독 조회의 사양 조건 미입력, LR4 조건 비교, 로그아웃 정리를 확인했다. 실제 4317 서버는 이전 API를 메모리에 유지하므로 적용 후 서버를 재시작하고 최신 UI를 로드한다. 새 실제 세션 로그인은 사용자 직접 입력이 필요하다. 승인한 SQL을 재생성하지 않고 manifest 해시를 확인한 파일로 실행한다.

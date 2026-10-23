# 홈 v3 적용과 "이 PC에서 로그인 유지" — 2026-10-23

## 목적

1. 테스트 중 새로고침마다 로그인하는 불편을 줄인다. 로그인 제거는 공개 주소의 고객 데이터 노출 위험으로 하지 않고, 사용자가 고른 "이 PC에서 로그인 유지"를 추가한다.
2. 배포된 홈이 한눈에 들어오지 않는다는 피드백(점검 결과 구조 7 : 색 3)에 따라 목업 v3 구조와 단색 배경을 실제 앱에 적용한다.

결정 근거는 [검토·결정 기록](../decisions/review-and-decisions.md)의 2026-10-23 절이다.

## 바꾼 것

- 로그인 창에 "이 PC에서 로그인 유지 (로그아웃 전까지)" 체크박스. 체크한 브라우저에만 Supabase 세션 저장, 다시 열 때 `/api/me` 계정 확인 통과 시에만 복원, 거부·만료 시 저장 세션 삭제, 로그아웃 시 삭제, 브라우저 저장소가 막히면 메모리로 동작. 비밀번호는 저장하지 않는다.
- 홈 v3: 날짜 + "오늘 할 일" 제목과 "지금 메일 확인" 버튼, 상태 한 줄(기한 지남·답변 대기·확인 필요·PC 미연결), 할 일 상위 3개(업무 제목 + 기한 배지, 종류·설명 첫 구절, 원문 펼침, 열기), "전체 할 일 보기 · N건 더", 답변 기다리는 중·확인 필요 두 칸, 전체 할 일 / 메모·연결 상태·메일 대조 접기. 홈을 볼 때만 단색 배경·흰 헤더/메뉴.
- 건수는 상태 한 줄에만 표시하고 큰 요약 카드·목차·카드 머리의 중복 건수를 없앴다.

## 변경 파일

- `web/crm-connection.mjs`(remember 옵션), `web/remote-app.mjs`(remember 사용, 저장 로그인 복원 시 로그인 창 생략, 제목 "오늘 할 일")
- `web/home-brief.mjs`(배지·짧은 줄·상태 줄·v3 배치), `web/style.css`(v3 스타일, 로그인 체크박스)
- 테스트: 신규 `tests/crm-remember.test.mjs`(5건), `tests/home-brief.test.mjs` 갱신, 합성 화면 fixture 제목·날짜
- 목업(앱·Git 밖): `D:/AI/projects/sp-sales-crm/outputs/mockups/home-v3-2026-10-23.html`, 회사 로고 사본

DB·SQL·API·Worker 인증 검사는 바꾸지 않았다.

## 검증

- 로그인 유지 테스트 5건을 먼저 작성해 실패를 확인한 뒤 구현했다. 홈 v3 테스트도 먼저 바꿔 실패를 확인했다.
- `npm test` 210/210, `npm run build:remote` 성공.
- 합성 화면(사용자 Chrome)에서 단색 배경, 상태 줄, 짧은 할 일 줄과 기한 배지, 두 칸, "전체 할 일 보기"가 접힌 목록을 여는 것, 가로 넘침 없음 확인.
- 배포와 실제 로그인 유지(체크 후 새로고침) 확인은 아래 배포 절에 남긴다.

## 복원 방법

배포 후 문제가 있으면 직전 Worker 버전으로 rollback하고, 코드는 해당 병합 커밋을 `git revert -m 1` 후 재배포한다. 저장된 로그인은 로그아웃하면 지워진다. DB 변경은 없다.

## 병합·배포

- [PR #6](https://github.com/Candy-Park/sp-sales-crm/pull/6) 병합 `9e33011`. 배포 전 Wrangler 계정이 배포 계정이고 `sp-sales-crm` Worker가 있는지 확인했다.
- main에서 테스트 210/210·빌드 후 배포. 이전 버전 `be877638-1574-4963-8b4a-606e90df1964` → 새 버전 `c3711c78-0bdc-4727-ac1c-914a7c713d65`. 변경 정적 파일 `app.js`, `style.css`.
- 배포 후 공개 `app.js`·`style.css` 해시 일치, 무인증 `/api/dashboard` 401, 로그인 창에 "이 PC에서 로그인 유지" 체크박스와 "오늘 할 일" 제목 표시 확인.
- 남은 확인: 사용자가 체크박스를 켜고 로그인한 뒤 새로고침해도 로그인이 유지되는지, 실제 데이터에서 v3 홈 표시.
- 되돌리기: `node node_modules/wrangler/bin/wrangler.js rollback be877638-1574-4963-8b4a-606e90df1964`, 코드는 main에서 `git revert -m 1 9e33011` 후 재배포.

## 짧은 주소로 변경

- `wrangler.jsonc` Worker 이름 `sp-sales-crm` → `crm`. 새 주소 `https://crm.piaoenya.workers.dev/`. 배포 전 같은 계정에 `crm` Worker가 없음을 확인했다.
- `start-crm-sync.cmd`의 PC 수집 연결 주소를 새 주소로 변경. `tools/handling-preview-server.mjs`의 주소 허용 검사는 `crm`과 기존 `sp-sales-crm` workers.dev 주소만 허용(다른 도메인·접미사 위장 거부 확인).
- README·문서 안내의 주소 갱신. 과거 작업 기록의 기존 주소는 당시 기록으로 보존.
- 검증: `npm test` 210/210, `npm run build:remote` 성공. 배포 결과는 아래에 이어서 기록.
- 기존 Worker `sp-sales-crm`은 삭제하지 않고 유지(마지막 배포 `c3711c78`). 삭제는 사용자 확인 후.
- 배포: [PR #8](https://github.com/Candy-Park/sp-sales-crm/pull/8) 병합 `1c55ceb` 후 배포 계정 확인, 새 Worker `crm` 버전 `7c27f855-aa44-44bd-9d7c-ad3413b499c0`.
- 확인: 새 주소 홈 200, 공개 `app.js`·`style.css` 해시가 빌드와 일치(기존 주소의 v3와 같은 빌드), 무인증 `/api/dashboard`·`/api/memos` 401, 설정의 Supabase 주소 동일, CSP·nosniff·no-referrer 유지, 사용자 Chrome에서 "오늘 할 일" 제목과 로그인 유지 체크박스 표시. 기존 주소도 아직 200(삭제 전).
- 로그인 유지는 주소(도메인)별로 저장되므로 새 주소에서 한 번 다시 체크하고 로그인해야 한다. PC 수집 연결은 다음 `start-crm-sync.cmd` 실행부터 새 주소를 쓴다(PC 미연결 상태라 실제 연결은 미확인).
- 되돌리기: `wrangler.jsonc` 이름·`start-crm-sync.cmd` 주소를 되돌리는 커밋 후 기존 주소로 다시 배포. 기존 Worker는 남아 있어 바로 사용 가능.

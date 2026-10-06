# 새 기본 DB 구성 기록 — Source Photonics sales CRM

## 작업 범위

새 프로젝트 sp-sales-crm만 대상. 기존 Notion 기반 sp-crm과 PC CRM을 보존한다. 사용자가 지정한 앱 로그인 이메일은 ignored 로컬 기록에 보관하며, 아직 Auth 계정 생성·초대 메일 발송·앱 권한 부여는 하지 않는다.

## 계획

- 새 프로젝트의 접속·리전·기존 테이블 수를 읽기로 검증한다.
- db/verify-basic-schema.sql의 초기 구조 검증 실패를 확인한다.
- db/schema-basic.sql로 기본 6개 테이블·관계·기초 정책을 생성한다. 앱 역할 권한은 닫힌 상태로 유지한다.
- 실제 구조 검증과 읽기 전용 점검을 다시 실행한다. 성공 후 결과·한계를 아래에 기록한다.

## 구조 및 검증 한계

schema-basic.sql은 재현 가능한 초기 SQL이며 Supabase migration 이력을 만든 것으로 보고하지 않는다. 실제 사용자별 allow/deny·관계 격리·종료 규칙·수정 revision·백업/E2E는 별도 구현/검증이 남는다. 앱 권한 개방 전까지 수동 업무 UI가 DB에 접속할 수 없다.

Git: CRM은 부모 하네스의 ignored 경로이고 독립 저장소는 아직 없어 강제 추가/커밋/push하지 않는다. 원격 반영은 새 DB의 승인 범위 기본 구조에만 한정한다. 외부 반영을 임의로 되돌리지 않는다.

## 실행 결과

- 새 프로젝트 생성 확인: sp-sales-crm, 서울, Healthy. 기존 sp-crm 접근/변경 없음. 암호/키 읽기 없음.
- 기본 DB 읽기 성공, public 테이블 0개 및 ensure_rls 이벤트 트리거 enabled 확인.
- 구조 테스트 RED: Expected 6 basic tables, got 0. 이후 스키마 생성 성공, GREEN: basic_schema_structure_passed. 검증 범위는 테이블 6개, RLS 6개, 정책 16개, 클라이언트 역할/공개 GRANT 0개.
- SQL 편집기 fill이 전체 Monaco 모델을 교체하지 못해 이전 쿼리 일부가 남는 오류 1회 발생. 파싱 실패로 DDL 미적용. 새 쿼리에서 Ctrl+A → paste → 시작 부분 확인으로 조건을 변경한 뒤 실행 성공. 같은 방식으로 검증 SQL 재실행.
- 로컬 코드: src/basic-work.mjs, tests/basic-work.test.mjs. 오늘/지연은 서울 날짜로 분류하고, 취소 근거·완료 근거·필수 미완료/다른 소유자의 Action을 검증한다. 순수 함수이며 DB 트랜잭션·409 처리·보안 검사를 대신하지 않는다.
- Node 미구현 7건 실패→구현 후 node --test 전체 7/7 통과. 기존 Python unittest 전체 9/9 통과. 새 의존성 설치 없음.
- 로그인 주소는 사용자 지정으로 로컬 notes에 기록. 생성 폼 이메일만 채움. 새 User Password 입력·제출은 사용자 인계. 자동 확인 기본 옵션 그대로이며 확인/초대 메일은 발송하지 않음. 계정/앱 접근 권한 아직 미생성/미부여.
- 증거는 지정 outputs의 기본 DB 검증 화면 및 앱 사용자 인계 화면. 비밀번호가 비어 있을 때 캡처.
- 다음: 앱 사용자 생성 확인 후 실제 소유자별 allow/deny 및 관계 제약 검증, 종료 트랜잭션/revision 규칙, 로그인·수동 Inquiry·Action·Dashboard UI/API 연결. 전체 A01/A02/A11/A12 완료가 아님.
- 복원: 코드/문서 변경은 해당 파일 단위로 복원 가능. 이미 생성한 새 DB 구조는 승인 없는 삭제/되돌리기를 하지 않는다. 기존 자료·DB 복원 불필요.

## 최종 검토와 재검증

- 검토에서 JavaScript Date가 존재하지 않는 날짜를 다음 달로 보정하는 문제를 발견했다. 실패 재현 테스트를 추가한 뒤 달력 날짜와 명시적 시간대 형식을 먼저 검증하도록 수정했다.
- 수정 후 새로 실행한 `node --test` 8/8, `python -m unittest discover -s tests -v` 9/9 통과. 합계 17개다. 실제 로그인·RLS·API/E2E 검증은 여전히 남아 있다.

## 앱 계정 생성 확인

사용자가 직접 비밀번호 입력·제출한 뒤 새 프로젝트 Auth Users 목록에 지정 계정이 생성된 것을 확인했다. 계정 식별자는 로컬 notes에만 보관했다. 비밀번호 조회·저장 없음. 증거: outputs/2026-10-06-app-user-created.jpg. 앱 접근 권한 부여 및 실제 로그인 검증은 남아 있다. 이 조회에서는 DB·권한 변경을 하지 않았다.

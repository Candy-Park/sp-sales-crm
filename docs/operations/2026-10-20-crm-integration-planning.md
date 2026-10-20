# 두 CRM 통합 계획 작성 기록 — 2026-10-20

## 목적·범위

사용자 요청에 따라 sp-sales-crm(A)과 Source Photonics CRM(B)의 중복 기능·데이터를 비교하고, 메일·문의·오늘 할 일의 통합 조회를 첫 목표로 하는 [검토용 계획](../decisions/crm-integration-plan.md)을 작성했다. 실제 앱 변경은 문서 검토 후 결정한다는 조건을 보존했다.

## 변경 파일과 보존

- `docs/decisions/crm-integration-plan.md`: 기능 13항목, 데이터 대조·상태 매핑, 중복 판정, 1차 요구사항 6개와 후속/제외 3개, 화면 4곳, 단계별 계획·복원·미결 결정·검수 사례 12개.
- `docs/decisions/review-and-decisions.md`: 요청·확정 목표와 권고/미결, 기존 별도 보존 결정과 후속 통합 범위의 관계를 기록.
- `docs/README.md`: 통합 검토와 작업 기록의 링크만 추가.
- 이 작업 기록: 검증·보존·다음 작업과 복원 방법.

기획서·최초 보존 계획·개발 보고서·검수 사례·앱 소스·DB SQL·인증·환경설정·실행 경로는 수정하지 않는다. B 저장소는 읽기만 수행했다. B의 초기 단계 설명과 실제 코드/최신 운영 기록의 차이를 계획에 명시하고 지침 파일 자체는 보존했다. 원본 업무·메일·사진·DB를 읽어 통합하거나 실데이터 중복 건수를 산정하지 않았다.

## 조사·백업·보관

A 시작 상태는 변경 없음, 브랜치는 `codex/login-access`, origin을 확인했고 `git pull --ff-only` 결과는 Already up to date였다. 비교 기준 A HEAD는 `cd1d8569067bdc5d75d80d9d997065a6b6ad179a`다. B는 `codex/shared-instructions-20260925`, HEAD `9b368dd33f44d35d6945c2225f2b99dad59fcc2a`였으며 기존 untracked `.playwright-mcp/`, `.superpowers/`를 보존하고 pull·수정을 수행하지 않았다.

기존 파일 수정 전 README와 검토·결정 기록의 사본을 D scratch의 `before/docs/`에 보관했다. 저장 경로를 먼저 확인·보고했으며 산출물과 일시 파일은 각각 다음을 사용한다.

- 납품: `D:/AI/projects/sp-sales-crm/outputs/planning/crm-integration-2026-10-20/`
- 임시/백업: `D:/AI/projects/sp-sales-crm/scratch/crm-integration-2026-10-20/`
- 납품 본문: `crm-integration-plan.md`, 재개 원본: `planning-state.json`(development, revision 1, draft).
- 문서 확인 결과: `document-verification.json`, `manifest.json`에 최종 파일 위치·크기·SHA256 및 문서 구조/링크 확인을 보관한다.

공유 가능한 기술 계획과 운영 기록만 기존 docs에 둔다. 납품 원본 JSON·검사 결과·개인 절대 경로와 백업 사본을 Git에 추가하지 않는다. D의 본문과 저장소 본문은 같은 기획 revision에서 생성해 해시를 비교한다.

## 검증 결과와 한계

- idea-planning-workshop 로컬 검사기를 D의 planning-state.json에 `--mode development --json`으로 새로 실행: 오류 0, 경고 0. 기능 의존성·화면 참조·MVP 검수의 범위 검사다.
- 별도 검토자가 계획만 읽고 중요한 누락을 점검했다. 기한/완료 충돌 시 안전한 오늘·초과 산정, 통신 장애와 권한 상실의 캐시 처리 차이 2건을 발견해 4·6절 및 T04/T09/T10에 반영했다.
- 최종 문서 검증은 D 파일 실경로·본문/상태 일치·필수 표/요구사항/검수 ID·docs 상대 링크·공개 문서 내 개인 경로/이메일 부재·docs 외 추적 변경 부재·공백 오류를 확인한다. 실제 결과는 D의 document-verification.json과 Git diff에 남긴다.
- 앱 테스트·빌드·실제 로그인·원격 스키마 조회·실데이터 비교·E2E·새 세션/모바일 검수는 이번 문서 작업에서 실행하지 않았다. 기존 문서에 있는 과거 검수 결과를 이번 통합의 성공으로 쓰지 않는다. T01~T12는 향후 합격 기준이며 통과 실적이 아니다.

## 커밋·원격과 다음 작업

보관 범위는 이 기록을 포함한 문서 4개만의 로컬 선별 커밋이다. 해당 커밋은 Git 로그에서 확인한다. 외부 Git push·Notion 쓰기·DB 쓰기·배포·계정 변경은 이번에 수행하지 않는다. 사용자 요청은 문서 기획이며 기존 원격 승인이나 과거 구현 승인을 이번 통합 실행 승인으로 확대하지 않는다.

완료 대상은 기능·데이터 대조와 통합 계획의 작성·문서 검증이다. 보류 대상은 실제 통합과 원격 반영이다. 사용자 선택은 계획 D01~D04(A 기반 읽기 통합, B 실사용 환경, PC 꺼짐 범위, 연결대장/권한 방식)이며 D05 저장 통합은 후속이다. 결정 후 단계 0의 읽기 점검부터 시작하고, 승인 범위가 정해질 때까지 구현하지 않는다.

복원은 이번 문서 커밋의 revert를 검토하거나 D의 before 사본과 변경 차이를 확인하는 방식이다. 다른 세션의 후속 편집은 덮어쓰지 않는다. 앱/DB에는 이번 변경이 없으므로 데이터 복원·삭제·환경 초기화를 수행하지 않는다.

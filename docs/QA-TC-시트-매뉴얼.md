# Google Sheets 기반 QA TC 생성 매뉴얼

Cursor에서 **기능 목록 시트**를 읽어 **QA용 테스트케이스(TC) 시트**를 만들 때 사용하는 실무 가이드입니다.

---

## 1. 이 매뉴얼로 할 수 있는 것

| 단계 | 설명 |
|------|------|
| 드라이런 | 시트만 읽고, 매핑·예상 TC 수만 보고 (시트 변경 없음) |
| P0 안전 실행 | 리스크 높은 영역만 골라 TC 생성 (행 수·시트명 제한) |
| 일부만 생성 | 도메인/행 범위/키워드 기준으로 필요한 구간만 생성 |
| 전체 생성 | 도메인 규칙에 맞춰 상세 TC를 새 시트에 채움 |

---

## 2. 사전 준비

1. **Cursor**에 **MCP `user-gsheets`**(Google Sheets)가 연결되어 있어야 합니다.
2. 대상 스프레드시트에 **편집 권한**이 있어야 새 시트·셀 쓰기가 가능합니다.  
   - 서비스 계정을 쓰는 경우, 해당 계정을 스프레드시트에 **공유(편집자)** 해 두어야 합니다.
3. 이 저장소에는 프로젝트 스킬 **`qa-tc-generator`** 가 등록되어 있습니다.

**스킬 위치**

- `.cursor/skills/qa-tc-generator/SKILL.md` — 실행 절차·규칙 본문
- `.cursor/skills/qa-tc-generator/templates.md` — 시나리오/단계 문장 템플릿
- `.cursor/skills/qa-tc-generator/mapping-rules.md` — 원본 컬럼 매핑·도메인 추정
- `.cursor/skills/qa-tc-generator/validation-checklist.md` — 생성 후 품질 점검

채팅에서 **기능 목록 시트 URL**을 주고 “`qa-tc-generator`로 TC 만들어줘”라고 하면 에이전트가 위 스킬을 참고합니다.

---

## 3. URL에서 꺼내는 값

| 항목 | 어디서 |
|------|--------|
| `spreadsheetId` | URL의 `/d/` 와 다음 `/` 사이 문자열 |
| `gid` | URL의 `gid=숫자` 또는 `#gid=숫자` |

예시:

```text
https://docs.google.com/spreadsheets/d/1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE/edit?gid=897604314#gid=897604314
```

- `spreadsheetId`: `1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE`
- `gid`: `897604314`

---

## 4. TC 시트 고정 컬럼 (17개)

한 행이 하나의 TC입니다. **순서를 바꾸지 않습니다.**

```text
TC_ID | Feature | Requirement_ID | Scenario | Precondition | Test_Steps | Test_Data | Expected_Result | Priority | Severity | Type | Environment | Owner | Status | Automation_Candidate | Traceability | Notes
```

- **Traceability**: 원본 시트의 행을 추적할 수 있게 `시트명!행번호` 또는 요구사항 ID를 넣습니다.
- 원본에 ID 컬럼이 없으면 스킬 규칙대로 `AUTO-{행번호}` 등으로 채울 수 있습니다.

---

## 5. 도메인별 TC 최소 세트 (요약)

요구사항 **한 건**을 기준으로, 아래 개수만큼 TC를 **최소**로 잡습니다.

| 도메인 | 최소 구성 |
|--------|-----------|
| 인증 (Auth) | Positive 2, Negative 2, Boundary 1, Security 2, Regression 1 |
| 결제 (Payment) | Positive 2, Negative 3, Boundary 2, Security·무결성 2, Regression 2 |
| 어드민 (Admin) | Positive 2, Negative 2, Boundary 1, Authorization 2, Audit 1, Regression 1 |

**Type** 허용값: `Functional`, `Negative`, `Boundary`, `Regression`, `Accessibility`, `Security`

**TC_ID 예시**: `AUTH-LOGIN-001`, `PAY-REFUND-003`, `ADMIN-RBAC-002`

자세한 문장 템플릿은 `templates.md`를 보세요.

---

## 6. 권장 워크플로

```mermaid
flowchart LR
  A[드라이런] --> B[P0만 생성]
  B --> C[전체 생성 및 리뷰]
```

1. **드라이런**: 읽기만 하고 예상 TC 수·매핑 이슈 확인  
2. **P0만**: 주문/결제/환불/권한/저장 등 고위험만 새 시트에 기록  
3. **전체**: 도메인 규칙에 따라 상세 TC 확장, `validation-checklist.md`로 검증  

---

## 7. 복사해서 쓰는 프롬프트

### 7-1. 드라이런 (읽기·매핑·예상치만)

```text
역할: 시니어 QA 리드.

목표: 아래 Google Sheets URL만 읽고, 시트를 수정하지 않는다.
- 접근 가능 여부, 메타데이터(시트 목록), gid에 해당하는 시트명
- 기능 목록으로 보이는 영역의 헤더·샘플 행 요약
- 컬럼 매핑 제안(Feature, Requirement_ID, Scenario, Traceability)
- 도메인 추정(Auth/Payment/Admin) 비율과 예상 TC 수(도메인별 최소 세트 규칙 기준)

URL:
https://docs.google.com/spreadsheets/d/1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE/edit?gid=897604314#gid=897604314

금지: 새 시트 생성, 셀 쓰기, 기존 데이터 삭제.
```

### 7-2. P0만 — 안전 1회 실행 (권장: 첫 실제 실행)

과생성·덮어쓰기 방지를 위해 **시트명 고정·행 배치 상한**을 넣었습니다.

```text
역할: qa-tc-generator 스킬을 따르는 시니어 QA 리드다.

목표: Google Sheets에서 기능목록만 읽고, P0 테스트케이스만 생성해 새 시트에 기록한다. 전체 TC 생성·기존 시트 덮어쓰기는 금지.

입력:
- spreadsheetUrl: https://docs.google.com/spreadsheets/d/1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE/edit?gid=897604314#gid=897604314
- sourceGid: 897604314
- targetSheetName: QA_TC_Master_P0_ONLY (이 이름으로만 생성. 이미 있으면 QA_TC_Master_P0_ONLY_YYYYMMDD로 변경)

도구: user-gsheets MCP만 사용. 순서 고정:
1) sheets_check_access → 쓰기 불가면 중단
2) sheets_get_metadata → 소스 시트 확인
3) sheets_get_values로 기능목록 읽기
4) sheets_insert_sheet로 targetSheetName 생성
5) 헤더 1행은 sheets_update_values로 고정 컬럼 17개
6) 데이터는 sheets_append_values(..., insertDataOption=INSERT_ROWS), 한 번에 최대 150행

P0 포함 규칙 (이 조건에 해당하는 행만 TC 생성):
- Payment: 주문/결제/환불/PG/빌링키/정기결제 실패·해지/금액·상태전이/멱등·중복 관련 문맥이 있는 기능
- Admin: 권한·역할·운영자 액션(저장으로 상태/노출/삭제 변경), 고객 PII 노출·마스킹, 감사/추적이 필요한 변경
- Auth: 로그인·세션·토큰·비밀번호 재설정·접근제어 문맥이 명시된 기능

P0 제외 (이번 실행에서 TC 만들지 않음):
- 단순 리스트 조회 UI, 필터 항목 나열, “노출 필요 항목” 텍스트만 있는 행
- 디자인/문구/글자수 가이드 미정인 항목만 있는 행

출력 행 규칙:
- 요구사항 1행당 P0 TC는 최대 3개 (과생성 방지). 부족하면 Notes에 Coverage_Gap
- Priority는 모두 P0. Severity는 S1~S3만, Type은 Functional/Negative/Security 중심
- TC_ID: DOMAIN-FEATURE-001 형식, Traceability: 시트명!행번호 필수
- Status=Draft, Automation_Candidate=N

완료 보고:
- 생성 시트명, 생성 TC 총 개수, P0로 분류된 원본 행 수, 제외한 행 수(이유 요약), Notes의 Coverage_Gap 목록
```

### 7-3. 전체 생성 (컬럼·매핑 고정 압축 프롬프트)

스킬의 전체 규칙과 동일한 톤으로 짧게 쓴 버전입니다. 에이전트에 붙여 넣고 `sourceGid`/`URL`만 바꿔 쓰면 됩니다.

```text
역할: 시니어 QA 리드. user-gsheets MCP로 시트를 읽고 QA_TC_Master를 생성한다.

입력: spreadsheetUrl + (선택) sourceSheetName, sourceGid, ownerDefault, environmentDefault, targetSheetName

출력 시트 컬럼(고정):
TC_ID | Feature | Requirement_ID | Scenario | Precondition | Test_Steps | Test_Data | Expected_Result | Priority | Severity | Type | Environment | Owner | Status | Automation_Candidate | Traceability | Notes

[원본→출력 매핑]
- 기능/모듈 → Feature, REQ ID/티켓 → Requirement_ID, 없으면 AUTO-{row}
- 설명/스토리 → Scenario(테스트 가능 문장으로 재작성)
- 사전조건 컬럼 → Precondition, 없으면 도메인 기본 전제
- Traceability: {시트명}!{행번호} 또는 원본 ID
- 누락 시 Notes에 MAPPING_GAP:{필드}

[도메인 최소 세트]
- Auth: Pos2 Neg2 Bnd1 Sec2 Reg1
- Payment: Pos2 Neg3 Bnd2 Sec2 Reg2
- Admin: Pos2 Neg2 Bnd1 Auth2 Audit1 Reg1

Type은 Functional/Negative/Boundary/Regression/Accessibility/Security만 사용.
실행 후 총 TC 수, 도메인별 수, Priority 분포, Coverage_Gap, MAPPING_GAP 집계를 보고한다.
```

### 7-4. 일부만 생성 (도메인·범위·키워드 제한)

대규모 시트에서 필요한 블록만 안전하게 만들 때 사용합니다.

```text
역할: qa-tc-generator 스킬을 따르는 시니어 QA 리드.

목표: 기능 목록 중 일부만 골라 QA TC를 생성한다.
전체 생성은 하지 않는다.

입력:
- spreadsheetUrl: https://docs.google.com/spreadsheets/d/1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE/edit?gid=897604314#gid=897604314
- sourceGid: 897604314
- targetSheetName: QA_TC_Partial_001
- domainScope: PAY
- rowStart: 60
- rowEnd: 220
- includeKeywords: 환불, 주문, 결제, PG
- excludeKeywords: 노출 필요 항목, 디자인, 가이드
- maxRequirements: 25
- maxTcPerRequirement: 3

실행 규칙:
1) user-gsheets MCP만 사용
2) check_access -> metadata -> get_values -> insert_sheet -> update_values/append_values 순서 고정
3) 필터 통과 행만 처리 (도메인/행 범위/키워드)
4) 한 요구사항당 최대 3개 TC만 생성
5) 기본 고정 컬럼 17개 유지

완료 보고:
- 생성 시트명
- 전체 원본 행 수 / 필터 통과 행 수 / 제외 행 수
- 제외 사유별 건수(도메인 불일치, 범위 외, 키워드 제외, 상한 초과)
- 생성 TC 총 개수, Priority 분포, Coverage_Gap
```

---

## 8. 실행 후 체크

생성이 끝나면 `.cursor/skills/qa-tc-generator/validation-checklist.md` 항목으로 확인합니다.  
특히 **Requirement_ID**, **Traceability**, **Expected_Result** 누락과 **중복 시나리오**를 먼저 봅니다.

---

## 9. 자주 막히는 경우

| 증상 | 조치 |
|------|------|
| 쓰기 실패 | 스프레드시트에 사용 중인 계정(또는 서비스 계정) **편집 권한**이 있는지 확인 |
| 시트를 못 찾음 | URL의 `gid`와 `sheets_get_metadata`의 시트 목록 대조 |
| TC가 너무 많음 | 먼저 **7-2 P0만** 실행 후 범위 확장 |
| 원하는 일부만 뽑고 싶음 | **7-4 일부만 생성**에서 `domainScope`, `rowStart/rowEnd`, `include/excludeKeywords`, `maxRequirements` 사용 |
| 원본 컬럼명이 제각각 | `mapping-rules.md` 키워드 매핑 적용, Notes에 `MAPPING_GAP` 기록 |

---

## 10. 보안 주의

- Google Sheets용 **서비스 계정 JSON 키**는 저장소에 커밋하지 마세요.  
- 이미 노출된 키는 **폐기·재발급**하고, Git 히스토리에서 제거 여부를 검토하세요.

---

## 11. 관련 파일 한눈에

| 파일 | 용도 |
|------|------|
| `.cursor/skills/qa-tc-generator/SKILL.md` | 에이전트 실행 절차·규칙 |
| `.cursor/skills/qa-tc-generator/templates.md` | TC 문장 템플릿 |
| `.cursor/skills/qa-tc-generator/mapping-rules.md` | 컬럼 매핑·도메인 추정 |
| `.cursor/skills/qa-tc-generator/validation-checklist.md` | 품질 게이트 |
| `docs/QA-TC-시트-매뉴얼.md` | 본 문서 (사용자 매뉴얼) |

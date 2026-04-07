# Google Sheets 기반 QA TC 생성 매뉴얼

**기능 목록 시트**를 읽어 **QA용 테스트케이스(TC) 시트**를 생성할 때 쓰는 실무 가이드입니다.

TC 생성은 **로컬에서 띄운 API 서버**가 Google Sheets와 통신해 수행하고, 운영·실행 인터페이스는 **웹 앱 waterbean** 하나로 제공합니다. **Cursor 채팅, MCP(`user-gsheets`), 에이전트 스킬로 시트를 직접 조작하는 방식은 사용하지 않습니다.**

---

## 1. 이 매뉴얼로 할 수 있는 것

| 기능 | 설명 |
|------|------|
| **Pipeline** | 스프레드시트 URL과 옵션을 넣고 한 번 실행 → 지정한 이름의 TC 시트에 결과 기록 |
| **진행 확인** | SSE로 Plan · Taxonomy · Generator · Evaluator 등 단계 진행 표시 |
| **결과 점검** | 통계 카드, 도메인·Priority 분포, Evaluator 이슈, (필요 시) LLM JSON 파싱 실패 로그 |

> **참고:** 예전 문서에 있던 **“시트만 읽고 쓰기 없는 드라이런”** 은 waterbean·현재 API에 **전용 모드로 없습니다.** 대신 아래 [권장 워크플로](#4-권장-워크플로)처럼 **복사본 스프레드시트·고유 출력 시트명·낮은 요구사항당 TC 상한**으로 먼저 시험하는 방식을 권장합니다.

---

## 2. 사전 준비

1. **Node.js 20+**, 저장소 루트에서 `npm install`.
2. **`api/.env`**  
   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`: Google Sheets API용 서비스 계정 JSON 경로 (`api/` 기준 상대 경로).  
   - `GEMINI_API_KEY`: 파이프라인(Taxonomy·Plan·Generator 등) 실행에 **필수**입니다.  
   - 그 외 변수는 [README.md](../README.md)의 환경 변수 표를 참고하세요.
3. 대상 스프레드시트에 **서비스 계정 이메일을 편집자로 공유**해 두어야 새 시트 생성·셀 쓰기가 됩니다.
4. (선택) 파이프라인 중간·최종 산출물을 파일로 남기려면 `PIPELINE_DEBUG_DIR` 등을 설정합니다. ([README.md](../README.md))

---

## 3. 실행 방법 (waterbean)

### 3-1. 서버 기동

터미널을 **두 개** 쓰거나, 루트의 `npm run dev`로 API와 클라이언트를 함께 띄울 수 있습니다.

```bash
# API (기본 포트 4000)
npm run dev:api

# waterbean (기본 포트 5174, /api 를 localhost:4000 으로 프록시)
npm run dev:waterbean
```

브라우저에서 **http://localhost:5174/waterbean** 을 엽니다. (`/` 는 `/waterbean` 으로 리다이렉트됩니다.)  
설정 화면은 **http://localhost:5174/setting** 입니다.  
waterbean은 내부적으로 **`/api/...`** 요청을 API로 넘깁니다.

### 3-2. Pipeline 화면 (단일 실행)

| UI 항목 | 의미 |
|---------|------|
| **Google Sheets URL** | 기능 목록이 있는 스프레드시트 주소 (`https://docs.google.com/spreadsheets/d/...`) |
| **출력 시트명** (`targetSheetName`) | TC를 쓸 시트 이름 **(필수)**. 기본값은 없음. URL 입력 후 **`GET /pipeline/source-sheet?url=`** 로 소스 탭명을 조회해 `TC_{탭명}` 형태로 자동 제안되며, 필요 시 직접 수정 가능 |
| **Fallback 라운드** | Evaluator 미통과 시 Generator 보강 최대 횟수 (0~3 단계 선택) |
| **요구사항당 최대 TC** | 요구사항(행)당 생성 TC 상한 (1~6) — 과다 생성 완화에 사용 |
| **Owner / Environment** | TC 시트에 채울 기본값 |
| **Skill** | `GET /pipeline/skills`로 내려오는 프리셋. waterbean 기본 선택은 **`sheet-grounded`**(기능목록 근거) |
| **유사 TC 병합** | 켜면 유사 케이스 병합 경로 사용 (`mergeSimilarTestCases`) |

백엔드는 **항상 Taxonomy(LLM) + 전체 도메인(ALL) + LLM 에이전트**만 사용합니다. 도메인 모드·도메인 범위·Engine 선택은 UI·API 요청에 없습니다.

**실행** 버튼은 **`POST /pipeline/run/async`** 를 호출한 뒤 SSE로 진행을 받고, 완료 후 결과 JSON을 표시합니다.

---

## 4. 권장 워크플로

```mermaid
flowchart LR
  A[복사본 또는 고유 출력 시트명] --> B[낮은 요구사항당 TC 상한]
  B --> C[스킬 조정 후 재실행]
```

1. **첫 실행**: 원본을 직접 건드리기 싫으면 스프레드시트를 **복사**한 뒤 그 URL로 실행하거나, 출력 시트명을 **`TC_시도1`** 등 고유하게 둡니다.
2. **과다 생성 완화**: **요구사항당 최대 TC**를 1~2로 낮추고, 필요하면 `default`·`auth-focused` 등 다른 스킬로 바꿔 비교합니다.
3. **비교**: 서로 다른 스킬은 **출력 시트명을 바꿔 여러 번 실행**해 결과를 비교합니다.

---

## 5. URL에서 꺼내는 값

브라우저에는 **전체 URL**만 넣으면 됩니다. 로그·문서용으로 id만 쓸 때 참고하세요.

| 항목 | 위치 |
|------|------|
| `spreadsheetId` | URL의 `/d/` 와 다음 `/` 사이 |
| `gid` | 쿼리 `gid=` 또는 `#gid=` (API에서 `sourceGid`로 넘길 때 사용 가능) |

예시:

```text
https://docs.google.com/spreadsheets/d/1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE/edit?gid=897604314#gid=897604314
```

- `spreadsheetId`: `1N5lngbjLziYwZGCRGJulGyr0HaX1LxmEk08am_QJaBE`
- `gid`: `897604314`

> waterbean UI에는 **소스 시트를 gid로 지정하는 필드가 없습니다.** 특정 시트만 소스로 쓰려면 **`POST /pipeline/run`** 또는 **`/pipeline/run/async`** 요청 본문에 `sourceGid`(또는 `sourceSheetName`)를 넣어 API를 직접 호출하세요. ([README.md](../README.md) API 절 참고)

---

## 6. TC 시트 고정 컬럼 (17개)

한 행이 하나의 TC입니다. **순서를 바꾸지 않습니다.**

```text
TC_ID | Feature | Requirement_ID | Scenario | Precondition | Test_Steps | Test_Data | Expected_Result | Priority | Severity | Type | Environment | Owner | Status | Automation_Candidate | Traceability | Notes
```

- **Traceability**: 원본 시트 행 추적용 `시트명!행번호` 또는 요구사항 ID.
- 원본에 ID 컬럼이 없으면 파이프라인 규칙에 따라 `AUTO-{행번호}` 등으로 채워질 수 있습니다.

---

## 7. 도메인별 TC 최소 세트 (요약)

요구사항 **한 건**을 기준으로, 아래 개수만큼 TC를 **최소**로 잡는 전제가 스킬·Evaluator와 맞물립니다.

| 도메인 | 최소 구성 |
|--------|-----------|
| 인증 (Auth) | Positive 2, Negative 2, Boundary 1, Security 2, Regression 1 |
| 결제 (Payment) | Positive 2, Negative 3, Boundary 2, Security·무결성 2, Regression 2 |
| 어드민 (Admin) | Positive 2, Negative 2, Boundary 1, Authorization 2, Audit 1, Regression 1 |

**Type** 허용값: `Functional`, `Negative`, `Boundary`, `Regression`, `Accessibility`, `Security`

**TC_ID 예시**: `AUTH-LOGIN-001`, `PAY-REFUND-003`, `ADMIN-RBAC-002`

문장 템플릿·매핑 힌트는 저장소의 **참고용** 스킬 문서를 볼 수 있습니다 (실행은 waterbean만 사용).

---

## 8. 스킬 프리셋

API **`GET /pipeline/skills`** 와 동일 목록이 waterbean Skill 드롭다운에 표시됩니다.

| 프리셋(id) | 용도 요약 |
|------------|-----------|
| `default` | 7도메인 범용 |
| `auth-focused` | 인증·보안 강조 |
| `sheet-grounded` | 기능명·설명 근거 위주 (PG 등 과생성 완화) |

자세한 필드 구조는 `api/src/skills/presets/` 및 [README.md](../README.md)를 참고하세요.

---

## 9. waterbean에 없는 고급 옵션 (API 직접 호출)

다음은 **요청 JSON**으로만 넘길 수 있고, 현재 waterbean 폼에는 없을 수 있습니다.

| 필드 | 설명 |
|------|------|
| `sourceGid` / `sourceSheetName` | 읽을 소스 시트 지정 |
| `evalSpecGrounding`, `evalTraceability` | 스펙 근거·Traceability 정합 게이트 `off` / `warn` / `block` |
| `highRiskMaxTcPerRequirement` | 고위험 구간별 TC 상한 등 세부 제어 |
| `domainMinSetFill`, `maxLlmRounds` | 도메인 최소 세트 채움 방식·LLM 라운드 상한 |

엔드포인트·기본값은 [README.md](../README.md)와 `api/src/routes/pipeline.ts`의 `RunRequestSchema`를 기준으로 하세요.

---

## 10. 실행 후 체크

1. **waterbean**에서 통계·도메인 분포·**Issues** 패널을 확인합니다. `success`가 아니면 메시지와 `evaluationIssues` 유형을 먼저 봅니다.
2. **LLM JSON 파싱 실패**가 있으면 결과에 **`llmJsonFailureLog`** 가 붙을 수 있으며, 이슈 패널에서 복사해 디버깅에 씁니다.
3. 시트 품질은 참고용 체크리스트 [`.cursor/skills/qa-tc-generator/validation-checklist.md`](../.cursor/skills/qa-tc-generator/validation-checklist.md)로 점검할 수 있습니다. (실행 경로는 waterbean입니다.)

특히 **Requirement_ID**, **Traceability**, **Expected_Result** 누락과 **중복 시나리오**를 우선 확인합니다.

---

## 11. 자주 막히는 경우

| 증상 | 조치 |
|------|------|
| 쓰기 실패 / 접근 거부 | 서비스 계정에 스프레드시트 **편집자** 공유 여부, `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` 경로 |
| Taxonomy·LLM 오류 | `GEMINI_API_KEY`·모델·타임아웃·레이트리밋 확인 |
| TC가 너무 많음 | **요구사항당 최대 TC** 하향, `sheet-grounded` 등 스킬 변경 |
| 출력 시트명이 비어 있음 | URL 입력 후 자동 제안이 실패하면(권한·URL 오류) **출력 시트명을 직접 입력** |
| 특정 시트만 읽고 싶음 | waterbean 대신 API에 `sourceGid` 또는 `sourceSheetName` 지정 |
| Taxonomy가 반복·느림 | Evaluator 재시도·LLM 호출 증가 가능. 터미널 로그·이슈 유형(`taxonomy_*`) 확인 ([README.md](../README.md) 진단 체크리스트) |
| 진행이 화면에서 멈춤 | API·브라우저 콘솔 확인. 네트워크 단절 시 SSE 폴링이 이어지도록 구현되어 있으나 타임아웃 메시지가 나올 수 있음 |

---

## 12. 보안 주의

- Google Sheets용 **서비스 계정 JSON 키**는 저장소에 커밋하지 마세요.
- 이미 노출된 키는 **폐기·재발급**하고, Git 히스토리 정리 여부를 검토하세요.
- `GEMINI_API_KEY` 역시 비밀 정보로 관리합니다.

---

## 13. 관련 문서

| 문서 | 용도 |
|------|------|
| [README.md](../README.md) | 아키텍처, 환경 변수, API 목록, 파이프라인(Taxonomy·LLM 고정) 설명 |
| [TC-파이프라인-후속-개발-로드맵.md](TC-파이프라인-후속-개발-로드맵.md) | 구현 베이스라인·S1 이후 과제 |
| `.cursor/skills/qa-tc-generator/*.md` | 템플릿·매핑·검증 **참고** (실행은 waterbean) |

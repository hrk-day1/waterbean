# Partner Center

Google Sheets 기능 목록으로부터 QA Test Case를 자동 생성하는 도구입니다.

## 프로젝트 구조

```
partner-center/
├── api/          # Express 백엔드 — TC 생성 파이프라인
├── waterbean/    # React SPA — TC Harness (파이프라인 실행 UI)
├── web/          # React SPA — 크리에이터 어드민 프로토타입
└── docs/         # 매뉴얼 문서
```

| 워크스페이스 | 포트 | 스택 | 설명 |
|---|---|---|---|
| `api` | 4000 | Express 5 · Google Sheets API · Zod | TC 생성 파이프라인 API 서버 |
| `waterbean` | 5174 | React 19 · Vite 8 · Tailwind 4 | Pipeline / Fork 실행 UI |
| `web` | 5173 | React 19 · Vite 8 · Tailwind 4 · shadcn | 크리에이터 어드민 프로토타입 |

## 시작하기

### 사전 준비

- Node.js 20+
- Google Cloud 서비스 계정 키 파일 (Sheets API 권한)

### 설치

```bash
npm install
```

### 환경 변수

프로젝트 루트에 `.env` 파일을 생성합니다. `.env.example`을 참고하세요.

```bash
cp .env.example .env
```

| 변수 | 설명 | 기본값 |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | 서비스 계정 키 JSON 경로 (api/ 기준 상대경로) | `../sa.json` |
| `PORT` | API 서버 포트 | `4000` |

### 개발 서버 실행

```bash
# 전체 (api + waterbean + web 동시 실행)
npm run dev

# 개별 실행
npm run dev:api        # API 서버
npm run dev:waterbean  # TC Harness UI
npm run dev:web        # 크리에이터 어드민 UI
```

### 빌드

```bash
npm run build   # 전체 워크스페이스 빌드
npm run lint    # 전체 워크스페이스 린트
```

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/health` | 헬스체크 |
| `GET` | `/pipeline/skills` | 등록된 스킬 목록 조회 |
| `POST` | `/pipeline/run` | 단일 파이프라인 실행 (TC 생성) |
| `POST` | `/pipeline/fork` | 복수 변형 병렬 실행 (비교 분석) |

## 파이프라인 흐름

```
Google Sheets 읽기 → Plan (체크리스트 생성) → Generator (TC 생성) → Evaluator (검증)
                                                                    ↓ 미통과 시
                                                              Fallback 라운드
                                                                    ↓
                                                           Google Sheets 쓰기
```

- **Plan**: 시트의 기능 목록을 파싱하여 체크리스트 항목을 구성합니다.
- **Generator**: Skill 규칙(프리셋)에 따라 TC를 자동 생성합니다.
- **Evaluator**: 스키마, 필수값, 도메인 최소 세트, 커버리지, 중복을 검증합니다.
- **Fallback**: 미커버 항목을 자동 보완하며, 최대 라운드 수를 설정할 수 있습니다.

## i18n

`waterbean`과 `web` 모두 `react-i18next` 기반 다국어를 지원합니다.

- 지원 언어: 한국어(ko, 기본), 영어(en)
- 번역 파일: 각 프로젝트의 `src/shared/locales/ko.json`, `en.json`
- 언어 전환: waterbean 헤더 우측 / web 사이드바 하단 버튼

## 문서

- [QA TC 시트 매뉴얼](docs/QA-TC-시트-매뉴얼.md)

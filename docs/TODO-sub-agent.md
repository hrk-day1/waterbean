# Sub-Agent 개발 TODO

> 현재 파이프라인은 `runner.ts`에서 Plan → Generator → Evaluator를 **동기적으로 순차 실행**한다.
> Sub-Agent는 이 3단계를 **독립적인 에이전트**로 분리하여, 도메인별 병렬 생성·실시간 진행 추적·에이전트 교체를 가능하게 한다.

---

## 현재 아키텍처 (AS-IS)

```
runner.ts
  ├── getSkill(skillId)
  ├── buildChecklist()          ← Plan (동기)
  ├── generateTestCases()       ← Generator (동기)
  ├── evaluate()                ← Evaluator (동기)
  ├── while(!passed) {          ← Fallback 루프 (동기)
  │     generateTestCases()
  │     evaluate()
  │   }
  └── writeToSheet()            ← 완료 후 일괄 기록
```

**문제점**: 전체가 단일 `runPipeline()` 호출이므로
- 도메인별 병렬 생성 불가
- 중간 진행 상태 확인 불가 (FE는 최종 결과만 수신)
- 특정 단계만 교체/재시도 불가

---

## 목표 아키텍처 (TO-BE)

```
SubAgentOrchestrator
  ├── PlanAgent        → ChecklistItem[] 반환 + 진행 이벤트
  ├── GeneratorAgent[] → 도메인별 병렬 실행, TestCase[] 반환 + 진행 이벤트
  ├── EvaluatorAgent   → EvaluationResult 반환 + 진행 이벤트
  └── Fallback 판단    → 미커버 항목에 대해 GeneratorAgent 재투입
```

---

## Phase 0: 기반 인프라

### 0-1. AgentMessage 프로토콜 정의

파일: `api/src/agents/types.ts`

```typescript
type AgentStatus = "pending" | "running" | "completed" | "failed";

interface AgentEvent {
  agentId: string;
  agentType: "plan" | "generator" | "evaluator";
  status: AgentStatus;
  progress: number;        // 0~100
  message: string;         // 사람이 읽을 수 있는 상태 메시지
  timestamp: string;
  payload?: unknown;       // 단계별 중간 결과
}

interface AgentResult<T> {
  agentId: string;
  agentType: string;
  status: "completed" | "failed";
  data: T | null;
  error?: string;
  durationMs: number;
}

interface SubAgentConfig {
  pipelineId: string;
  skillId: string;
  domainScope: string;
  // Plan/Generator/Evaluator 각각에 필요한 설정은 제네릭으로
}
```

**핵심 설계 원칙**:
- 모든 에이전트는 `AgentEvent`를 emit하고, `AgentResult<T>`를 반환한다
- 에이전트 간 통신은 **데이터 전달**이지 직접 호출이 아님 (orchestrator가 중재)

### 0-2. EventBus 구현

파일: `api/src/agents/event-bus.ts`

- Node.js `EventEmitter` 기반의 인메모리 이벤트 버스
- `emit(pipelineId, AgentEvent)` / `subscribe(pipelineId, callback)`
- SSE(Server-Sent Events) 또는 WebSocket으로 FE에 전달하는 어댑터 포함

```typescript
interface EventBus {
  emit(pipelineId: string, event: AgentEvent): void;
  subscribe(pipelineId: string, cb: (event: AgentEvent) => void): () => void;
}
```

> **선택지**: SSE vs WebSocket
> - SSE 권장 (단방향, 구현 단순, Express 호환)
> - WebSocket은 양방향 필요 시 (에이전트 중단/재시도 명령)

### 0-3. SSE 엔드포인트

파일: `api/src/routes/pipeline.ts`에 추가

```
GET /pipeline/run/:pipelineId/events → SSE 스트림
```

- `pipelineId`는 `POST /pipeline/run` 응답에서 즉시 반환
- FE는 pipelineId를 받자마자 SSE 연결하여 진행 이벤트 수신

---

## Phase 1: 에이전트 분리

### 1-1. PlanAgent

파일: `api/src/agents/plan-agent.ts`

**입력**: `{ raw: string[][], sourceSheetName, skill }`
**출력**: `AgentResult<ChecklistItem[]>`

현재 `plan.ts`의 `detectHeaderAndData()` + `buildChecklist()`를 래핑한다.

```typescript
class PlanAgent {
  constructor(private bus: EventBus, private config: SubAgentConfig) {}

  async run(raw: string[][], sourceSheetName: string, skill: SkillManifest): Promise<AgentResult<ChecklistItem[]>> {
    this.bus.emit(this.config.pipelineId, { status: "running", progress: 0, message: "헤더 감지 중..." });
    const { headers, dataRows, headerRowIndex } = detectHeaderAndData(raw);

    this.bus.emit(this.config.pipelineId, { status: "running", progress: 50, message: "체크리스트 구축 중..." });
    const checklist = buildChecklist(headers, dataRows, sourceSheetName, headerRowIndex, skill);

    this.bus.emit(this.config.pipelineId, { status: "completed", progress: 100, message: `${checklist.length}건 체크리스트 완료` });
    return { status: "completed", data: checklist, durationMs: /* 측정 */ };
  }
}
```

**변경 범위**: `plan.ts`는 그대로 유지 (순수 함수). PlanAgent가 래핑만 함.

### 1-2. GeneratorAgent

파일: `api/src/agents/generator-agent.ts`

**입력**: `{ checklist: ChecklistItem[], config: GeneratorConfig, skill }`
**출력**: `AgentResult<TestCase[]>`

**핵심 변경**: 도메인별 분할 병렬 실행

```typescript
class GeneratorAgent {
  async run(checklist: ChecklistItem[], config: GeneratorConfig, skill: SkillManifest): Promise<AgentResult<TestCase[]>> {
    // 도메인별 그룹핑
    const groups = groupBy(checklist, (item) => item.domain);

    // 도메인별 병렬 생성
    const results = await Promise.all(
      Object.entries(groups).map(async ([domain, items]) => {
        this.bus.emit(id, { message: `${domain} 도메인 TC 생성 중 (${items.length}건)...` });
        return generateTestCases(items, config, skill);
      })
    );

    const merged = results.flat();
    return { status: "completed", data: merged };
  }
}
```

**변경 범위**: `generator.ts`는 그대로 유지. GeneratorAgent가 분할+병합 처리.

### 1-3. EvaluatorAgent

파일: `api/src/agents/evaluator-agent.ts`

**입력**: `{ checklist, testCases, skill }`
**출력**: `AgentResult<EvaluationResult>`

현재 `evaluator.ts`의 `evaluate()`를 래핑하고, 검증 단계별로 이벤트를 emit한다.

```typescript
class EvaluatorAgent {
  async run(checklist, testCases, skill): Promise<AgentResult<EvaluationResult>> {
    this.bus.emit(id, { progress: 20, message: "스키마 검증 중..." });
    // validateSchema
    this.bus.emit(id, { progress: 40, message: "필수필드 검증 중..." });
    // validateRequiredFields
    this.bus.emit(id, { progress: 60, message: "도메인 최소세트 검증 중..." });
    // validateDomainMinSets
    this.bus.emit(id, { progress: 80, message: "커버리지 검증 중..." });
    // validateCoverage
    this.bus.emit(id, { progress: 100, message: "검증 완료" });
    return { status: "completed", data: evalResult };
  }
}
```

**변경 범위**: `evaluator.ts`는 그대로 유지.

---

## Phase 2: Orchestrator

### 2-1. SubAgentOrchestrator

파일: `api/src/agents/orchestrator.ts`

현재 `runner.ts`의 `runPipeline()`을 대체하는 오케스트레이터.

```typescript
class SubAgentOrchestrator {
  constructor(private bus: EventBus) {}

  async run(config: PipelineConfig): Promise<PipelineResult> {
    const pipelineId = crypto.randomUUID().slice(0, 8);
    const skill = getSkill(config.skillId);

    // 1) 소스 시트 읽기
    const raw = await readSheetValues(...);

    // 2) PlanAgent
    const planAgent = new PlanAgent(this.bus, { pipelineId, ... });
    const planResult = await planAgent.run(raw, sourceSheetName, skill);

    // 3) GeneratorAgent (도메인별 병렬)
    const genAgent = new GeneratorAgent(this.bus, { pipelineId, ... });
    const genResult = await genAgent.run(planResult.data, generatorConfig, skill);

    // 4) EvaluatorAgent
    const evalAgent = new EvaluatorAgent(this.bus, { pipelineId, ... });
    let evalResult = await evalAgent.run(planResult.data, genResult.data, skill);

    // 5) Fallback 루프
    let round = 1;
    let allTCs = genResult.data;
    while (!evalResult.data.passed && evalResult.data.uncoveredItems.length > 0 && round <= config.maxFallbackRounds) {
      this.bus.emit(pipelineId, { message: `Fallback round ${round}` });
      const extraTCs = await genAgent.run(evalResult.data.uncoveredItems, generatorConfig, skill);
      allTCs = [...allTCs, ...extraTCs.data];
      evalResult = await evalAgent.run(planResult.data, allTCs, skill);
      round++;
    }

    // 6) 시트 기록
    await writeToSheet(allTCs);

    return { pipelineId, success: evalResult.data.passed, ... };
  }
}
```

### 2-2. 기존 runner.ts 호환

- `runPipeline()`은 유지하되, 내부를 `SubAgentOrchestrator.run()`으로 위임
- 기존 `/pipeline/run` API는 동일하게 동작 (하위 호환)
- SSE 이벤트 수신은 **선택적** (FE가 연결하지 않으면 이벤트는 버려짐)

---

## Phase 3: API 확장

### 3-1. 실행 응답 변경

현재 `POST /pipeline/run`은 파이프라인 완료까지 blocking 후 결과 반환.
Sub-Agent 모드에서는:

```
POST /pipeline/run  →  { pipelineId: "abc123" }   (즉시 반환)
GET  /pipeline/run/abc123/events  →  SSE 스트림
GET  /pipeline/run/abc123/result  →  최종 결과 (완료 전이면 202)
```

### 3-2. 에이전트 상태 조회

```
GET /pipeline/run/:pipelineId/agents  →  각 에이전트의 현재 상태
```

응답 예시:
```json
{
  "pipelineId": "abc123",
  "agents": [
    { "agentId": "plan-001", "type": "plan", "status": "completed", "durationMs": 340 },
    { "agentId": "gen-auth", "type": "generator", "status": "running", "progress": 65 },
    { "agentId": "gen-content", "type": "generator", "status": "pending" },
    { "agentId": "eval-001", "type": "evaluator", "status": "pending" }
  ]
}
```

### 3-3. 인메모리 상태 저장소

파일: `api/src/agents/store.ts`

- `Map<pipelineId, PipelineExecution>` 형태의 인메모리 저장소
- `PipelineExecution` = `{ config, agents: AgentState[], result?, startedAt, completedAt? }`
- GC: 완료 후 30분 경과 시 자동 삭제

---

## Phase 4: Waterbean FE

### 4-1. SSE 클라이언트

파일: `waterbean/src/shared/lib/sse-client.ts`

```typescript
function subscribeToEvents(pipelineId: string, onEvent: (event: AgentEvent) => void): () => void {
  const es = new EventSource(`/api/pipeline/run/${pipelineId}/events`);
  es.onmessage = (e) => onEvent(JSON.parse(e.data));
  return () => es.close();
}
```

### 4-2. 진행 상태 UI

파일: `waterbean/src/features/pipeline/view/components/agent-progress.tsx`

- 각 에이전트(Plan, Generator x N, Evaluator)를 카드로 표시
- 진행률 바 + 상태 아이콘 (pending/running/completed/failed)
- 도메인별 Generator 에이전트를 개별 표시
- Fallback 라운드 진입 시 새로운 Generator/Evaluator 행 추가

### 4-3. use-pipeline 훅 확장

파일: `waterbean/src/features/pipeline/controller/use-pipeline.ts`

```typescript
// 기존: run() → 최종 결과 대기
// 변경: run() → pipelineId 수신 → SSE 구독 → 이벤트별 상태 업데이트 → 완료 시 결과 fetch

const [agents, setAgents] = useState<AgentEvent[]>([]);
const [pipelineId, setPipelineId] = useState<string | null>(null);
```

---

## Phase 5: 에이전트 교체 (확장)

### 5-1. 에이전트 인터페이스 추상화

```typescript
interface Agent<TInput, TOutput> {
  readonly type: string;
  run(input: TInput, bus: EventBus, pipelineId: string): Promise<AgentResult<TOutput>>;
}
```

모든 에이전트가 이 인터페이스를 구현하면, Orchestrator는 구체 타입을 모른 채 실행 가능.

### 5-2. 에이전트 레지스트리

파일: `api/src/agents/registry.ts`

```typescript
// 기본 에이전트 등록
registerAgent("plan", "default", DefaultPlanAgent);
registerAgent("generator", "default", DefaultGeneratorAgent);
registerAgent("generator", "llm", LlmGeneratorAgent);  // 향후 LLM 기반 생성기
registerAgent("evaluator", "default", DefaultEvaluatorAgent);
```

- `PipelineConfig`에 `agentOverrides?: Record<AgentType, string>` 추가
- 특정 단계만 다른 에이전트로 교체 가능

### 5-3. LLM Generator (향후)

파일: `api/src/agents/llm-generator-agent.ts`

- 템플릿 기반 생성 대신 LLM에 체크리스트 + 컨텍스트를 전달하여 TC 생성
- Skill의 `templates`를 few-shot 예시로 활용
- Evaluator에서 검증 후 품질 미달 시 재생성

---

## 구현 순서 요약

| 순서 | 작업 | 난이도 | 선행 조건 |
|------|------|--------|-----------|
| 0-1 | `AgentMessage` 프로토콜 (types.ts) | 낮음 | 없음 |
| 0-2 | `EventBus` (event-bus.ts) | 낮음 | 0-1 |
| 0-3 | SSE 엔드포인트 | 중간 | 0-2 |
| 1-1 | `PlanAgent` | 낮음 | 0-1, 0-2 |
| 1-2 | `GeneratorAgent` (도메인 병렬) | 중간 | 0-1, 0-2 |
| 1-3 | `EvaluatorAgent` | 낮음 | 0-1, 0-2 |
| 2-1 | `Orchestrator` | 중간 | 1-1, 1-2, 1-3 |
| 2-2 | 기존 `runner.ts` 호환 래핑 | 낮음 | 2-1 |
| 3-1 | API 비동기 응답 구조 | 중간 | 2-1, 0-3 |
| 3-2 | 에이전트 상태 조회 API | 낮음 | 3-1 |
| 3-3 | 인메모리 상태 저장소 | 낮음 | 2-1 |
| 4-1 | SSE 클라이언트 (FE) | 낮음 | 0-3 |
| 4-2 | 에이전트 진행 UI | 중간 | 4-1 |
| 4-3 | `use-pipeline` 훅 확장 | 중간 | 4-1 |
| 5-1 | 에이전트 인터페이스 추상화 | 낮음 | 1-* |
| 5-2 | 에이전트 레지스트리 | 중간 | 5-1 |
| 5-3 | LLM Generator (향후) | 높음 | 5-2 |

---

## 파일 구조 예상

```
api/src/
├── agents/
│   ├── types.ts              ← AgentEvent, AgentResult, SubAgentConfig
│   ├── event-bus.ts          ← EventBus (EventEmitter 기반)
│   ├── store.ts              ← 인메모리 실행 상태 저장소
│   ├── registry.ts           ← 에이전트 레지스트리 (Phase 5)
│   ├── orchestrator.ts       ← SubAgentOrchestrator
│   ├── plan-agent.ts         ← PlanAgent (plan.ts 래핑)
│   ├── generator-agent.ts    ← GeneratorAgent (generator.ts 래핑 + 도메인 병렬)
│   ├── evaluator-agent.ts    ← EvaluatorAgent (evaluator.ts 래핑)
│   └── llm-generator-agent.ts  ← LLM 기반 생성기 (Phase 5)
├── pipeline/
│   ├── plan.ts               ← 기존 유지 (순수 함수)
│   ├── generator.ts          ← 기존 유지 (순수 함수)
│   ├── evaluator.ts          ← 기존 유지 (순수 함수)
│   ├── runner.ts             ← 기존 유지, 내부를 orchestrator로 위임
│   └── fork-runner.ts        ← 기존 유지
├── skills/                   ← 기존 유지
├── routes/
│   └── pipeline.ts           ← SSE 엔드포인트 추가
└── ...

waterbean/src/
├── shared/
│   └── lib/
│       ├── api-client.ts     ← 기존 유지
│       └── sse-client.ts     ← SSE 구독 유틸리티 (신규)
├── features/
│   └── pipeline/
│       ├── controller/
│       │   └── use-pipeline.ts  ← SSE 구독 + agents 상태 관리 추가
│       └── view/
│           └── components/
│               └── agent-progress.tsx  ← 에이전트별 진행 UI (신규)
└── ...
```

---

## 주의사항

1. **기존 코드 비파괴**: `plan.ts`, `generator.ts`, `evaluator.ts`는 순수 함수로 유지. 에이전트가 래핑만 한다.
2. **하위 호환**: `POST /pipeline/run`의 기존 blocking 방식도 유지. FE가 SSE를 사용하지 않으면 기존과 동일하게 동작.
3. **Fork와의 관계**: `fork-runner.ts`도 내부적으로 `SubAgentOrchestrator`를 사용하도록 변경하면, Fork 실행에서도 각 variant의 에이전트 진행 상태를 실시간 추적 가능.
4. **Skill과의 관계**: 에이전트는 Skill을 주입받아 사용. Skill이 에이전트의 "규칙"이고, 에이전트가 "실행자".
5. **메모리 관리**: 인메모리 저장소는 TTL 기반 정리 필수. 장기 운영 시 Redis 등 외부 저장소 고려.

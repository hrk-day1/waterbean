# Sub-Agent 남은 TODO

구현 확인 후, **완료된 항목은 제거**하고 남은 작업만 정리했다.

## 남은 항목

### 1) API 응답 구조 일원화

- 현재 비동기 시작은 `POST /pipeline/run/async`로 제공됨.
- 문서 목표였던 `POST /pipeline/run` 즉시 반환(`pipelineId`) 방식으로 완전히 전환할지 결정 필요.
- 하위 호환 정책(동기/비동기 공존)을 유지할 경우, API 문서와 FE 호출 규약을 명확히 분리해야 함.

### 2) 에이전트 선택 오버라이드

- `registry.ts`/`setup.ts` 기반 등록은 구현됨.
- 하지만 `PipelineConfig`에 `agentOverrides`가 아직 없어 요청 단위로 단계별 에이전트 교체는 불가.
- 예: plan만 deterministic, generator만 llm 같은 조합 실행 옵션 추가 필요.

### 3) Generator 병렬 전략 정리

- LLM Generator는 도메인별 병렬(`Promise.all`)이 적용되어 있음.
- Deterministic Generator는 단일 호출 기반이라 병렬 분할 전략이 없음.
- 구현 의도상 두 구현체의 실행 전략을 통일할지, LLM 전용 최적화로 문서화할지 결정 필요.

### 4) FE 진행 UI 세부 요구 보강

- `agent-progress.tsx`에서 에이전트별 상태/진행률 표시는 동작함.
- 다만 “Fallback 라운드별 신규 Generator/Evaluator 행”을 명시적으로 구분해 보여주는 UX는 추가 개선 여지 있음.

## 메모

- 이미 구현 완료된 항목(타입 프로토콜, EventBus, SSE, Plan/Generator/Evaluator 분리, 오케스트레이터, 상태 저장소, 결과/에이전트 조회 API, `use-pipeline` SSE 연동, 에이전트 인터페이스/레지스트리, LLM Generator)은 이 문서에서 삭제했다.

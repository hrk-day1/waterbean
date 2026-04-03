import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "@/shared/lib/api-client";
import { subscribeToPipelineEvents, type AgentEvent } from "@/shared/lib/sse-client";

interface PriorityDistribution {
  P0: number;
  P1: number;
  P2: number;
}

interface TypeDistribution {
  Functional: number;
  Negative: number;
  Boundary: number;
  Regression: number;
  Accessibility: number;
  Security: number;
}

interface EvaluationIssue {
  type: string;
  message: string;
}

interface PipelineStats {
  totalTCs: number;
  domainDistribution: Record<string, number>;
  priorityDistribution: PriorityDistribution;
  typeDistribution: TypeDistribution;
  coverageGaps: string[];
  mappingGaps: string[];
}

export interface PipelineResult {
  success: boolean;
  sheetName: string;
  rounds: number;
  stats: PipelineStats;
  evaluationIssues: EvaluationIssue[];
  /** API가 LLM JSON 파싱 실패 시 내려줌 */
  llmJsonFailureLog?: string;
}

export interface PipelineRequest {
  spreadsheetUrl: string;
  targetSheetName: string;
  domainMode?: "preset" | "discovered";
  domainScope: string;
  ownerDefault: string;
  environmentDefault: string;
  maxFallbackRounds: number;
  skillId: string;
  implementation?: "deterministic" | "llm";
  mergeSimilarTestCases?: boolean;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
}

/** 오케스트레이터 SSE `payload` (선택). */
export interface OrchestratorProgressPayload {
  phase?: "batch_generate" | "final_eval" | "final_fallback" | "merge";
  batchCurrent?: number;
  batchTotal?: number;
  batchSize?: number;
  checklistTotal?: number;
  checklistInBatch?: number;
  tcGeneratedThisBatch?: number;
  tcCountSoFar?: number;
  totalTcCount?: number;
  uncoveredCount?: number;
  evalRound?: number;
  maxFallbackRounds?: number;
}

export interface AgentState {
  agentId: string;
  agentType: "taxonomy" | "taxonomy-evaluator" | "plan" | "generator" | "merge" | "evaluator";
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  /** SSE 이벤트의 상세 진행 정보(오케스트레이터 등) */
  payload?: OrchestratorProgressPayload;
}

export function useSkills() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillSummary[]>([]);

  useEffect(() => {
    apiGet<SkillSummary[]>("/pipeline/skills")
      .then(setSkills)
      .catch(() => setSkills([{ id: "default", name: t("error.defaultSkill"), description: "" }]));
  }, [t]);

  return skills;
}

const POLL_MS = 2000;
const POLL_MAX = 90;

export function usePipeline() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const updateAgent = useCallback((event: AgentEvent) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.agentId === event.agentId);
      const payload =
        event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? (event.payload as OrchestratorProgressPayload)
          : undefined;
      const state: AgentState = {
        agentId: event.agentId,
        agentType: event.agentType,
        status: event.status,
        progress: event.progress,
        message: event.message,
        ...(payload ? { payload } : {}),
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = state;
        return next;
      }
      return [...prev, state];
    });
  }, []);

  const finishPipeline = useCallback(
    (data: PipelineResult) => {
      clearPoll();
      setResult(data);
      if (!data.success) {
        const gaps = data.stats?.coverageGaps ?? [];
        const issues = data.evaluationIssues ?? [];
        const msg = issues[0]?.message ?? gaps[0] ?? t("error.unknown");
        setError(msg);
      }
      setLoading(false);
      setStatusMessage(null);
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    },
    [clearPoll, t],
  );

  const run = useCallback(
    async (request: PipelineRequest) => {
      setLoading(true);
      setError(null);
      setResult(null);
      setAgents([]);
      setStatusMessage(t("pipeline.progress.starting", "실행을 시작합니다…"));

      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      clearPoll();

      try {
        const { pipelineId } = await apiPost<{ pipelineId: string }>("/pipeline/run/async", request);
        setStatusMessage(t("pipeline.progress.running", "파이프라인 처리 중…"));

        let pollAttempts = 0;
        const startPoll = () => {
          clearPoll();
          pollRef.current = setInterval(async () => {
            pollAttempts += 1;
            if (pollAttempts > POLL_MAX) {
              clearPoll();
              setError(t("pipeline.progress.timeout", "진행 상태를 확인하지 못했습니다. 잠시 후 결과를 다시 확인해 주세요."));
              setLoading(false);
              setStatusMessage(null);
              if (unsubRef.current) {
                unsubRef.current();
                unsubRef.current = null;
              }
              return;
            }
            try {
              const res = await fetch(`/api/pipeline/run/${pipelineId}/result`);
              if (res.status === 200) {
                finishPipeline((await res.json()) as PipelineResult);
              }
            } catch {
              // keep polling
            }
          }, POLL_MS);
        };

        unsubRef.current = subscribeToPipelineEvents(
          pipelineId,
          (ev) => {
            updateAgent(ev);
            setStatusMessage(ev.message);
          },
          (payload) => {
            clearPoll();
            if (payload && typeof payload === "object" && "success" in (payload as object)) {
              finishPipeline(payload as PipelineResult);
            } else {
              void (async () => {
                try {
                  const res = await fetch(`/api/pipeline/run/${pipelineId}/result`);
                  if (res.status === 200) {
                    finishPipeline((await res.json()) as PipelineResult);
                  } else {
                    setLoading(false);
                    setStatusMessage(null);
                  }
                } catch {
                  setLoading(false);
                  setStatusMessage(null);
                }
              })();
            }
          },
          () => {
            startPoll();
          },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : t("error.unknown"));
        setLoading(false);
        setStatusMessage(null);
        clearPoll();
      }
    },
    [t, updateAgent, clearPoll, finishPipeline],
  );

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return { run, loading, result, error, agents, statusMessage };
}

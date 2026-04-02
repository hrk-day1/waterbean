import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/shared/lib/api-client";
import { subscribeToForkEvents, type AgentEvent } from "@/shared/lib/sse-client";
import type { AgentState } from "@/features/pipeline/controller/use-pipeline";

interface ForkVariant {
  label: string;
  skillId: string;
  domainMode?: "preset" | "discovered";
  domainScope: string;
  maxFallbackRounds: number;
}

interface PipelineStats {
  totalTCs: number;
  domainDistribution: Record<string, number>;
  priorityDistribution: { P0: number; P1: number; P2: number };
  typeDistribution: Record<string, number>;
  coverageGaps: string[];
  mappingGaps: string[];
}

interface EvaluationIssue {
  type: string;
  message: string;
}

interface PipelineResult {
  success: boolean;
  sheetName: string;
  rounds: number;
  stats: PipelineStats;
  evaluationIssues: EvaluationIssue[];
  llmJsonFailureLog?: string;
}

export interface ForkVariantResult {
  label: string;
  result: PipelineResult;
}

export interface ForkResult {
  forkId: string;
  completedAt: string;
  results: ForkVariantResult[];
}

export interface ForkRequest {
  spreadsheetUrl: string;
  baseSheetName: string;
  ownerDefault: string;
  environmentDefault: string;
  variants: ForkVariant[];
}

const POLL_MS = 2000;
const POLL_MAX = 90;

export function useFork() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForkResult | null>(null);
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
      const state: AgentState = {
        agentId: event.agentId,
        agentType: event.agentType,
        status: event.status,
        progress: event.progress,
        message: event.message,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = state;
        return next;
      }
      return [...prev, state];
    });
  }, []);

  const finishFork = useCallback(
    (data: ForkResult) => {
      clearPoll();
      setResult(data);
      setLoading(false);
      setStatusMessage(null);
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    },
    [clearPoll],
  );

  const run = useCallback(
    async (request: ForkRequest) => {
      setLoading(true);
      setError(null);
      setResult(null);
      setAgents([]);
      setStatusMessage(t("fork.progress.starting", "Fork 실행을 시작합니다…"));

      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      clearPoll();

      try {
        const { forkId } = await apiPost<{ forkId: string }>("/pipeline/fork/async", request);
        setStatusMessage(t("fork.progress.running", "변형별 파이프라인 실행 중…"));

        let pollAttempts = 0;
        const startPoll = () => {
          clearPoll();
          pollRef.current = setInterval(async () => {
            pollAttempts += 1;
            if (pollAttempts > POLL_MAX) {
              clearPoll();
              setError(t("fork.progress.timeout", "진행 상태를 확인하지 못했습니다."));
              setLoading(false);
              setStatusMessage(null);
              if (unsubRef.current) {
                unsubRef.current();
                unsubRef.current = null;
              }
              return;
            }
            try {
              const res = await fetch(`/api/pipeline/fork/${forkId}/result`);
              if (res.status === 200) {
                finishFork((await res.json()) as ForkResult);
              }
            } catch {
              // keep polling
            }
          }, POLL_MS);
        };

        unsubRef.current = subscribeToForkEvents(
          forkId,
          (ev) => {
            updateAgent(ev);
            setStatusMessage(ev.message);
          },
          (payload) => {
            clearPoll();
            if (payload && typeof payload === "object" && "results" in (payload as object)) {
              finishFork(payload as ForkResult);
            } else {
              void (async () => {
                try {
                  const res = await fetch(`/api/pipeline/fork/${forkId}/result`);
                  if (res.status === 200) {
                    finishFork((await res.json()) as ForkResult);
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
    [t, updateAgent, clearPoll, finishFork],
  );

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return { run, loading, result, error, agents, statusMessage };
}

import { useTranslation } from "react-i18next";
import type { AgentState, OrchestratorProgressPayload } from "../../controller/use-pipeline";
import { Card } from "@/shared/ui/card";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

function formatOrchestratorPayload(
  p: OrchestratorProgressPayload | undefined,
  t: (key: string, opt?: Record<string, string | number>) => string,
): string | null {
  if (!p?.phase) return null;
  if (p.phase === "batch_generate") {
    const bits: string[] = [];
    if (p.batchCurrent != null && p.batchTotal != null) {
      bits.push(t("pipeline.agentDetail.batchOf", { cur: p.batchCurrent, total: p.batchTotal }));
    } else if (p.batchTotal != null) {
      bits.push(t("pipeline.agentDetail.batchTotal", { total: p.batchTotal }));
    }
    if (p.checklistTotal != null) {
      bits.push(t("pipeline.agentDetail.checklistTotal", { n: p.checklistTotal }));
    }
    if (p.checklistInBatch != null) {
      bits.push(t("pipeline.agentDetail.checklistInBatch", { n: p.checklistInBatch }));
    }
    if (p.tcGeneratedThisBatch != null) {
      bits.push(t("pipeline.agentDetail.tcThisBatch", { n: p.tcGeneratedThisBatch }));
    }
    if (p.tcCountSoFar != null) {
      bits.push(t("pipeline.agentDetail.tcSoFar", { n: p.tcCountSoFar }));
    }
    if (p.batchSize != null) {
      bits.push(t("pipeline.agentDetail.batchSize", { n: p.batchSize }));
    }
    return bits.length ? bits.join(" · ") : null;
  }
  if (p.phase === "final_eval") {
    return t("pipeline.agentDetail.finalEval", {
      checklist: p.checklistTotal ?? "—",
      tc: p.totalTcCount ?? "—",
    });
  }
  if (p.phase === "final_fallback") {
    return t("pipeline.agentDetail.finalFallback", {
      uncovered: p.uncoveredCount ?? "—",
      round: p.evalRound ?? "—",
      maxRounds: p.maxFallbackRounds ?? "—",
      tc: p.totalTcCount ?? "—",
    });
  }
  return null;
}

interface AgentProgressProps {
  agents: AgentState[];
}

const STATUS_ICONS = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
} as const;

const STATUS_COLORS = {
  pending: "text-zinc-400",
  running: "text-accent",
  completed: "text-emerald-500",
  failed: "text-danger",
} as const;

const AGENT_LABELS: Record<string, string> = {
  taxonomy: "Taxonomy",
  "taxonomy-evaluator": "Taxonomy Evaluator",
  plan: "Plan",
  generator: "Generator",
  merge: "Merge",
  evaluator: "Evaluator",
};

export function AgentProgress({ agents }: AgentProgressProps) {
  const { t } = useTranslation();

  if (agents.length === 0) return null;

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-zinc-700">
        {t("pipeline.agentProgress.title", "Agent Progress")}
      </h3>
      <div className="space-y-2">
        {agents.map((agent) => {
          const Icon = STATUS_ICONS[agent.status];
          const color = STATUS_COLORS[agent.status];
          const isOrchestrator = agent.agentId === "orchestrator";
          const detail = isOrchestrator ? formatOrchestratorPayload(agent.payload, t) : null;
          const label = isOrchestrator
            ? t("pipeline.agentProgress.orchestrator")
            : agent.agentType === "taxonomy"
              ? t("pipeline.agentProgress.taxonomy")
              : agent.agentType === "taxonomy-evaluator"
                ? t("pipeline.agentProgress.taxonomyEvaluator")
                : agent.agentType === "merge"
                  ? t("pipeline.agentProgress.merge")
                  : (AGENT_LABELS[agent.agentType] ?? agent.agentType);

          return (
            <div key={agent.agentId} className="flex items-center gap-3">
              <Icon
                className={`h-4 w-4 shrink-0 ${color} ${agent.status === "running" ? "animate-spin" : ""}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-zinc-700">
                    {label}
                    <span className="ml-1 text-xs text-zinc-400">({agent.agentId})</span>
                  </span>
                  <span className="text-xs text-zinc-500">{agent.progress}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      agent.status === "failed" ? "bg-danger" : "bg-accent"
                    }`}
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
                <p
                  className={`mt-0.5 text-xs text-zinc-600 ${isOrchestrator ? "whitespace-pre-wrap break-words" : "truncate"}`}
                >
                  {agent.message}
                </p>
                {detail && (
                  <p className="mt-1 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug text-zinc-500">
                    {detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

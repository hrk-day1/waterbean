import { useTranslation } from "react-i18next";
import type { AgentState } from "../../controller/use-pipeline";
import { Card } from "@/shared/ui/card";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

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
          const label =
            agent.agentId === "fork-root"
              ? t("fork.agentProgress.root")
              : agent.agentId.startsWith("fork-")
                ? t("fork.agentProgress.variant", { label: agent.agentId.slice(5) })
                : agent.agentType === "taxonomy"
                  ? t("pipeline.agentProgress.taxonomy")
                  : agent.agentType === "taxonomy-evaluator"
                    ? t("pipeline.agentProgress.taxonomyEvaluator")
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
                <p className="mt-0.5 truncate text-xs text-zinc-500">{agent.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

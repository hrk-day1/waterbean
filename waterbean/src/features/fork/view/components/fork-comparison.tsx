import { useTranslation } from "react-i18next";
import { Card } from "@/shared/ui/card";
import type { ForkVariantResult } from "../../controller/use-fork";
import { CheckCircle2, XCircle } from "lucide-react";

interface Props {
  results: ForkVariantResult[];
}

const DOMAINS = ["Auth", "Payment", "Content", "Membership", "Community", "Creator", "Admin"] as const;

export function ForkComparison({ results }: Props) {
  const { t } = useTranslation();

  if (results.length === 0) return null;

  const priorities = ["P0", "P1", "P2"] as const;

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-sm font-semibold">{t("fork.comparison.overview")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 pr-4 font-medium text-zinc-500">{t("fork.comparison.metric")}</th>
                {results.map((r) => (
                  <th key={r.label} className="pb-2 pr-4 font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-2 pr-4 text-zinc-500">{t("fork.comparison.result")}</td>
                {results.map((r) => (
                  <td key={r.label} className="py-2 pr-4">
                    {r.result.success ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-4 w-4" /> PASS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-danger">
                        <XCircle className="h-4 w-4" /> FAIL
                      </span>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-zinc-500">{t("fork.comparison.totalTCs")}</td>
                {results.map((r) => (
                  <td key={r.label} className="py-2 pr-4 font-mono">
                    {r.result.stats.totalTCs}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-zinc-500">{t("fork.comparison.outputSheet")}</td>
                {results.map((r) => (
                  <td key={r.label} className="py-2 pr-4 font-mono text-xs">
                    {r.result.sheetName}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-zinc-500">{t("fork.comparison.fallbackRounds")}</td>
                {results.map((r) => (
                  <td key={r.label} className="py-2 pr-4 font-mono">
                    {r.result.rounds}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-zinc-500">{t("fork.comparison.coverageGap")}</td>
                {results.map((r) => (
                  <td key={r.label} className="py-2 pr-4 font-mono">
                    {r.result.stats.coverageGaps.length}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-zinc-500">{t("fork.comparison.evalIssues")}</td>
                {results.map((r) => (
                  <td key={r.label} className="py-2 pr-4 font-mono">
                    {r.result.evaluationIssues.length}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold">{t("fork.comparison.domainDist")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 pr-4 font-medium text-zinc-500">{t("fork.comparison.domainCol")}</th>
                {results.map((r) => (
                  <th key={r.label} className="pb-2 pr-4 font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {DOMAINS.map((d) => (
                <tr key={d}>
                  <td className="py-2 pr-4 text-zinc-500">{d}</td>
                  {results.map((r) => {
                    const dist = r.result.stats.domainDistribution as Record<string, number>;
                    return (
                      <td key={r.label} className="py-2 pr-4 font-mono">
                        {dist[d] ?? 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold">{t("fork.comparison.priorityDist")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 pr-4 font-medium text-zinc-500">Priority</th>
                {results.map((r) => (
                  <th key={r.label} className="pb-2 pr-4 font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {priorities.map((p) => (
                <tr key={p}>
                  <td className="py-2 pr-4 text-zinc-500">{p}</td>
                  {results.map((r) => (
                    <td key={r.label} className="py-2 pr-4 font-mono">
                      {r.result.stats.priorityDistribution[p]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

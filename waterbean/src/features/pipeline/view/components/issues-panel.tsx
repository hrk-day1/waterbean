import { useTranslation } from "react-i18next";
import { Card } from "@/shared/ui/card";
import type { PipelineResult } from "../../controller/use-pipeline";

interface IssuesPanelProps {
  result: PipelineResult;
}

const ISSUE_TYPES = ["schema", "required_field", "domain_min", "coverage", "duplicate"] as const;

export function IssuesPanel({ result }: IssuesPanelProps) {
  const { t } = useTranslation();
  const { stats, evaluationIssues } = result;
  const hasGaps = stats.coverageGaps.length > 0 || stats.mappingGaps.length > 0;

  const typeLabel = (type: string) =>
    ISSUE_TYPES.includes(type as (typeof ISSUE_TYPES)[number])
      ? t(`issues.type.${type}`)
      : type;

  if (evaluationIssues.length === 0 && !hasGaps) {
    return (
      <Card className="border-success/30 bg-success/5">
        <p className="text-sm font-medium text-success">{t("issues.allPassed")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {evaluationIssues.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-zinc-700">
            Evaluation Issues ({evaluationIssues.length})
          </h3>
          <ul className="space-y-1.5 text-sm">
            {evaluationIssues.slice(0, 20).map((issue, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium">
                  {typeLabel(issue.type)}
                </span>
                <span className="text-zinc-600">{issue.message}</span>
              </li>
            ))}
            {evaluationIssues.length > 20 && (
              <li className="text-xs text-zinc-400">
                {t("issues.moreItems", { count: evaluationIssues.length - 20 })}
              </li>
            )}
          </ul>
        </Card>
      )}

      {stats.coverageGaps.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-warning">
            Coverage Gap ({stats.coverageGaps.length})
          </h3>
          <ul className="space-y-1 text-sm text-zinc-600">
            {stats.coverageGaps.map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </Card>
      )}

      {stats.mappingGaps.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-zinc-500">
            Mapping Gap ({stats.mappingGaps.length})
          </h3>
          <ul className="space-y-1 text-sm text-zinc-500">
            {stats.mappingGaps.slice(0, 10).map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
            {stats.mappingGaps.length > 10 && (
              <li className="text-xs">{t("issues.moreItems", { count: stats.mappingGaps.length - 10 })}</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}

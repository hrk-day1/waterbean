import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import type { PipelineResult } from "../../controller/use-pipeline";

interface IssuesPanelProps {
  result: PipelineResult;
}

const ISSUE_TYPES = [
  "schema",
  "required_field",
  "domain_min",
  "coverage",
  "duplicate",
  "test_point_missing",
  "spec_ungrounded",
  "traceability_mismatch",
] as const;

export function IssuesPanel({ result }: IssuesPanelProps) {
  const { t } = useTranslation();
  const { stats, evaluationIssues } = result;
  const hasGaps = stats.coverageGaps.length > 0 || stats.mappingGaps.length > 0;
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const typeLabel = (type: string) =>
    ISSUE_TYPES.includes(type as (typeof ISSUE_TYPES)[number])
      ? t(`issues.type.${type}`)
      : type;

  const toggleIssue = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selectAllIssues = useCallback(() => {
    setSelected(new Set(evaluationIssues.map((_, i) => i)));
  }, [evaluationIssues]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const copyPayload = useCallback(
    async (mode: "all_issues" | "selected_issues" | "full") => {
      const payload =
        mode === "full"
          ? {
              exportedAt: new Date().toISOString(),
              sheetName: result.sheetName,
              success: result.success,
              evaluationIssues,
              coverageGaps: stats.coverageGaps,
              mappingGaps: stats.mappingGaps,
            }
          : {
              exportedAt: new Date().toISOString(),
              sheetName: result.sheetName,
              success: result.success,
              evaluationIssues:
                mode === "all_issues"
                  ? evaluationIssues
                  : evaluationIssues.filter((_, i) => selected.has(i)),
            };

      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      } catch {
        return;
      }
    },
    [evaluationIssues, result.sheetName, result.success, selected, stats.coverageGaps, stats.mappingGaps],
  );

  if (evaluationIssues.length === 0 && !hasGaps) {
    return (
      <Card className="border-success/30 bg-success/5">
        <p className="text-sm font-medium text-success">{t("issues.allPassed")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {(evaluationIssues.length > 0 || hasGaps) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="text-xs" onClick={() => void copyPayload("full")}>
            {t("issues.copyFullJson")}
          </Button>
          {evaluationIssues.length > 0 && (
            <>
              <Button type="button" variant="ghost" className="text-xs" onClick={() => void copyPayload("all_issues")}>
                {t("issues.copyAllIssuesJson")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-xs"
                onClick={() => void copyPayload("selected_issues")}
                disabled={selected.size === 0}
              >
                {t("issues.copySelectedIssuesJson")}
              </Button>
              <Button type="button" variant="ghost" className="text-xs" onClick={selectAllIssues}>
                {t("issues.selectAll")}
              </Button>
              <Button type="button" variant="ghost" className="text-xs" onClick={clearSelection}>
                {t("issues.clearSelection")}
              </Button>
            </>
          )}
          <p className="text-xs text-zinc-500">{t("issues.triageHint")}</p>
        </div>
      )}

      {evaluationIssues.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-zinc-700">
            Evaluation Issues ({evaluationIssues.length})
          </h3>
          <ul className="space-y-1.5 text-sm">
            {evaluationIssues.slice(0, 50).map((issue, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-300"
                  checked={selected.has(i)}
                  onChange={() => toggleIssue(i)}
                  aria-label={t("issues.selectIssue", { index: i + 1 })}
                />
                <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium">
                  {typeLabel(issue.type)}
                </span>
                <span className="text-zinc-600">{issue.message}</span>
              </li>
            ))}
            {evaluationIssues.length > 50 && (
              <li className="text-xs text-zinc-400">
                {t("issues.moreItems", { count: evaluationIssues.length - 50 })}
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

      {result.llmJsonFailureLog ? (
        <Card className="border-warning/40">
          <h3 className="mb-2 text-sm font-semibold text-warning">
            {t("issues.llmJsonDebugTitle", "LLM JSON 디버그 (서버 동일 로그)")}
          </h3>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">
            {result.llmJsonFailureLog}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}

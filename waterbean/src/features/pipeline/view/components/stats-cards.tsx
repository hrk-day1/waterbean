import { useTranslation } from "react-i18next";
import { Card } from "@/shared/ui/card";
import type { PipelineResult } from "../../controller/use-pipeline";

interface StatsCardsProps {
  result: PipelineResult;
}

export function StatsCards({ result }: StatsCardsProps) {
  const { t } = useTranslation();
  const { stats } = result;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card>
        <p className="text-xs font-medium text-zinc-500">{t("stats.totalTCs")}</p>
        <p className="mt-1 text-2xl font-bold">{stats.totalTCs}</p>
      </Card>
      <Card>
        <p className="text-xs font-medium text-zinc-500">{t("stats.rounds")}</p>
        <p className="mt-1 text-2xl font-bold">{result.rounds}</p>
      </Card>
      <Card>
        <p className="text-xs font-medium text-zinc-500">{t("stats.sheetName")}</p>
        <p className="mt-1 text-lg font-semibold truncate">{result.sheetName}</p>
      </Card>
      <Card>
        <p className="text-xs font-medium text-zinc-500">{t("stats.result")}</p>
        <p className={`mt-1 text-2xl font-bold ${result.success ? "text-success" : "text-warning"}`}>
          {result.success ? "PASS" : "WARN"}
        </p>
      </Card>
    </div>
  );
}

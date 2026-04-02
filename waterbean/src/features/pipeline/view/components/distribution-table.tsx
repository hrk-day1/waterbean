import { useTranslation } from "react-i18next";
import { Card } from "@/shared/ui/card";
import type { PipelineResult } from "../../controller/use-pipeline";

interface DistributionTableProps {
  result: PipelineResult;
}

export function DistributionTable({ result }: DistributionTableProps) {
  const { t } = useTranslation();
  const { stats } = result;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-zinc-700">{t("distribution.domain")}</h3>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(stats.domainDistribution).map(([domain, count]) => (
              <tr key={domain} className="border-t border-border">
                <td className="py-1.5 font-medium">{domain}</td>
                <td className="py-1.5 text-right tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-zinc-700">{t("distribution.priority")}</h3>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(stats.priorityDistribution).map(([priority, count]) => (
              <tr key={priority} className="border-t border-border">
                <td className="py-1.5 font-medium">{priority}</td>
                <td className="py-1.5 text-right tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-zinc-700">{t("distribution.type")}</h3>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(stats.typeDistribution).map(([type, count]) => (
              <tr key={type} className="border-t border-border">
                <td className="py-1.5 font-medium">{type}</td>
                <td className="py-1.5 text-right tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

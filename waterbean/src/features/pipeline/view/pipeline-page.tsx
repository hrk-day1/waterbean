import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePipeline, useSkills } from "../controller/use-pipeline";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { Card } from "@/shared/ui/card";
import { StatsCards } from "./components/stats-cards";
import { DistributionTable } from "./components/distribution-table";
import { IssuesPanel } from "./components/issues-panel";
import { Info, Loader2 } from "lucide-react";

const DOMAIN_KEYS = ["all", "auth", "payment", "content", "membership", "community", "creator", "admin"] as const;
const DOMAIN_VALUES = ["ALL", "AUTH", "PAY", "CONTENT", "MEMBERSHIP", "COMMUNITY", "CREATOR", "ADMIN"] as const;

const FALLBACK_KEYS = ["0", "1", "2", "3"] as const;

export function PipelinePage() {
  const { t } = useTranslation();
  const { run, loading, result, error } = usePipeline();
  const skills = useSkills();

  const domainOptions = useMemo(
    () => DOMAIN_KEYS.map((key, i) => ({ value: DOMAIN_VALUES[i], label: t(`pipeline.domain.${key}`) })),
    [t],
  );

  const fallbackOptions = useMemo(
    () => FALLBACK_KEYS.map((key) => ({ value: key, label: t(`pipeline.fallback.${key}`) })),
    [t],
  );

  const [url, setUrl] = useState("");
  const [sheetName, setSheetName] = useState("QA_TC_Master");
  const [domain, setDomain] = useState("ALL");
  const [owner, setOwner] = useState("TBD");
  const [env, setEnv] = useState("WEB-CHROME");
  const [fallback, setFallback] = useState("2");
  const [skillId, setSkillId] = useState("default");

  const skillOptions = skills.map((s) => ({ value: s.id, label: s.name }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    run({
      spreadsheetUrl: url.trim(),
      targetSheetName: sheetName,
      domainScope: domain,
      ownerDefault: owner,
      environmentDefault: env,
      maxFallbackRounds: Number(fallback),
      skillId,
    });
  };

  const selectedSkill = skills.find((s) => s.id === skillId);

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="space-y-1 text-sm text-zinc-600">
          <p className="font-medium text-zinc-800">{t("pipeline.info.title")}</p>
          <p>{t("pipeline.info.desc1")}</p>
          {selectedSkill && (
            <p className="text-xs text-zinc-500">
              {t("pipeline.info.selectedSkill")} <span className="font-medium text-zinc-700">{selectedSkill.name}</span> &mdash; {selectedSkill.description}
            </p>
          )}
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            id="url"
            label="Google Sheets URL"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              id="sheetName"
              label={t("pipeline.label.sheetName")}
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
            />
            <Select
              id="domain"
              label={t("pipeline.label.domainScope")}
              options={domainOptions}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <Select
              id="fallback"
              label={t("pipeline.label.fallbackRounds")}
              options={fallbackOptions}
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id="owner"
              label={t("pipeline.label.owner")}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
            <Input
              id="env"
              label={t("pipeline.label.environment")}
              value={env}
              onChange={(e) => setEnv(e.target.value)}
            />
            {skillOptions.length > 0 && (
              <Select
                id="skill"
                label="Skill"
                options={skillOptions}
                value={skillId}
                onChange={(e) => setSkillId(e.target.value)}
              />
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !url.trim()}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t("pipeline.button.running") : t("pipeline.button.run")}
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      )}

      {result && (
        <div className="space-y-6">
          <StatsCards result={result} />
          <DistributionTable result={result} />
          <IssuesPanel result={result} />
        </div>
      )}
    </div>
  );
}

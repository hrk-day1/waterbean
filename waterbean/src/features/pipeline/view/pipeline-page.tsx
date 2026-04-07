import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchSourceSheetMeta, usePipeline, useSkills } from "../controller/use-pipeline";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";
import { Card } from "@/shared/ui/card";
import { StatsCards } from "./components/stats-cards";
import { DistributionTable } from "./components/distribution-table";
import { IssuesPanel } from "./components/issues-panel";
import { AgentProgress } from "./components/agent-progress";
import { RunProgressBanner } from "@/shared/ui/run-progress-banner";
import { useAutoScrollBottom } from "@/shared/lib/use-auto-scroll-bottom";
import { Info, Loader2 } from "lucide-react";

const SHEETS_URL_HINT = /\/spreadsheets\/d\//;

function looksLikeSheetsUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" && SHEETS_URL_HINT.test(u.pathname);
  } catch {
    return false;
  }
}

export function PipelinePage() {
  const { t } = useTranslation();
  const { run, loading, result, error, agents, statusMessage } = usePipeline();
  const skills = useSkills();

  const [url, setUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [owner, setOwner] = useState("TBD");
  const [env, setEnv] = useState("WEB-CHROME");
  const [fallbackRounds, setFallbackRounds] = useState(2);
  const [maxTcPerRequirement, setMaxTcPerRequirement] = useState(5);
  const [skillId, setSkillId] = useState("sheet-grounded");
  const [mergeSimilarTestCases, setMergeSimilarTestCases] = useState(false);
  const [sheetMetaError, setSheetMetaError] = useState<string | null>(null);
  const [sheetMetaLoading, setSheetMetaLoading] = useState(false);
  const [submitSheetError, setSubmitSheetError] = useState(false);

  const userEditedTargetSheet = useRef(false);

  const skillOptions = skills.map((s) => ({ value: s.id, label: s.name }));

  useEffect(() => {
    if (skills.length === 0) return;
    const ids = new Set(skills.map((s) => s.id));
    if (!ids.has(skillId)) {
      const next = ids.has("sheet-grounded") ? "sheet-grounded" : skills[0]!.id;
      setSkillId(next);
    }
  }, [skills, skillId]);

  useEffect(() => {
    userEditedTargetSheet.current = false;
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    const trimmed = url.trim();
    if (!looksLikeSheetsUrl(trimmed)) {
      setSheetMetaError(null);
      setSheetMetaLoading(false);
      return;
    }

    const tmr = window.setTimeout(() => {
      void (async () => {
        setSheetMetaLoading(true);
        setSheetMetaError(null);
        try {
          const meta = await fetchSourceSheetMeta(trimmed);
          if (cancelled) return;
          if (!userEditedTargetSheet.current) {
            setSheetName(meta.suggestedTargetSheetName);
          }
        } catch (e) {
          if (!cancelled) {
            setSheetMetaError(e instanceof Error ? e.message : t("pipeline.sheetMeta.error"));
          }
        } finally {
          if (!cancelled) setSheetMetaLoading(false);
        }
      })();
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [url, t]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitSheetError(false);
    if (!url.trim()) return;
    if (!sheetName.trim()) {
      setSubmitSheetError(true);
      return;
    }

    run({
      spreadsheetUrl: url.trim(),
      targetSheetName: sheetName.trim(),
      ownerDefault: owner,
      environmentDefault: env,
      maxTcPerRequirement,
      maxFallbackRounds: fallbackRounds,
      skillId,
      mergeSimilarTestCases,
    });
  };

  const selectedSkill = skills.find((s) => s.id === skillId);
  const bottomRef = useAutoScrollBottom([agents, result, error]);

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

          <div>
            <Input
              id="sheetName"
              label={t("pipeline.label.sheetName")}
              placeholder={t("pipeline.sheetName.placeholder")}
              value={sheetName}
              onChange={(e) => {
                userEditedTargetSheet.current = true;
                setSheetName(e.target.value);
                setSubmitSheetError(false);
              }}
              aria-invalid={submitSheetError}
            />
            <div className="mt-1 flex min-h-[1.25rem] items-center gap-2 text-xs text-zinc-500">
              {sheetMetaLoading && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  {t("pipeline.sheetMeta.loading")}
                </span>
              )}
              {!sheetMetaLoading && sheetMetaError && (
                <span className="text-danger">{sheetMetaError}</span>
              )}
              {!sheetMetaLoading && !sheetMetaError && sheetName && (
                <span>{t("pipeline.sheetMeta.hint")}</span>
              )}
            </div>
            {submitSheetError && (
              <p className="mt-1 text-xs text-danger">{t("pipeline.sheetName.required")}</p>
            )}
          </div>

          <div className="space-y-4 border-t border-border pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {t("pipeline.section.runOptions")}
            </p>

            <div className="grid gap-6 md:grid-cols-3">
              <Slider
                id="fallback"
                label={t("pipeline.label.fallbackRounds")}
                min={0}
                max={3}
                value={fallbackRounds}
                onValueChange={setFallbackRounds}
                valueDescription={t(`pipeline.fallback.${fallbackRounds}` as const)}
              />
              <Slider
                id="maxTcPerRequirement"
                label={t("pipeline.label.maxTcPerRequirement")}
                min={1}
                max={6}
                value={maxTcPerRequirement}
                onValueChange={setMaxTcPerRequirement}
                valueDescription={t(`pipeline.maxTcPerRequirement.${maxTcPerRequirement}` as const)}
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

            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>

            <Switch
              id="mergeSimilar"
              label={t("pipeline.label.mergeSimilarTestCases")}
              description={t("pipeline.mergeSimilar.hint")}
              checked={mergeSimilarTestCases}
              onCheckedChange={setMergeSimilarTestCases}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !url.trim() || !sheetName.trim()}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t("pipeline.button.running") : t("pipeline.button.run")}
            </Button>
          </div>
        </form>
      </Card>

      <RunProgressBanner message={loading ? statusMessage : null} />

      <AgentProgress agents={agents} />

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

      <div ref={bottomRef} />
    </div>
  );
}

import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFork } from "../controller/use-fork";
import { useSkills } from "@/features/pipeline/controller/use-pipeline";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { Card } from "@/shared/ui/card";
import { ForkComparison } from "./components/fork-comparison";
import { AgentProgress } from "@/features/pipeline/view/components/agent-progress";
import { RunProgressBanner } from "@/shared/ui/run-progress-banner";
import { useAutoScrollBottom } from "@/shared/lib/use-auto-scroll-bottom";
import { Info, Loader2, Plus, Trash2 } from "lucide-react";

const FORK_DOMAIN_VALUES = ["ALL", "AUTH", "PAY", "CONTENT", "MEMBERSHIP", "COMMUNITY", "CREATOR", "ADMIN"] as const;
const FORK_DOMAIN_KEYS = ["all", "auth", "payment", "content", "membership", "community", "creator", "admin"] as const;
const FORK_FALLBACK_KEYS = ["0", "1", "2", "3"] as const;
const FORK_MAX_TC_KEYS = ["1", "2", "3", "4", "5", "6"] as const;

interface VariantForm {
  label: string;
  skillId: string;
  domainMode: "preset" | "discovered";
  domainScope: string;
  maxFallbackRounds: string;
}

function createVariant(label: string, skillId = "default"): VariantForm {
  return { label, skillId, domainMode: "preset", domainScope: "ALL", maxFallbackRounds: "2" };
}

export function ForkPage() {
  const { t } = useTranslation();
  const { run, loading, result, error, agents, statusMessage } = useFork();
  const skills = useSkills();
  const skillOptions = skills.map((s) => ({ value: s.id, label: s.name }));

  const domainOptions = useMemo(
    () => FORK_DOMAIN_KEYS.map((key, i) => ({ value: FORK_DOMAIN_VALUES[i], label: t(`fork.domain.${key === "all" ? "all" : key}`) })),
    [t],
  );

  const fallbackOptions = useMemo(
    () => FORK_FALLBACK_KEYS.map((key) => ({ value: key, label: t(`fork.fallback.${key}`) })),
    [t],
  );

  const maxTcPerReqOptions = useMemo(
    () =>
      FORK_MAX_TC_KEYS.map((key) => ({
        value: key,
        label: t(`pipeline.maxTcPerRequirement.${key}`, `${key} TC`),
      })),
    [t],
  );

  const [url, setUrl] = useState("");
  const [baseSheet, setBaseSheet] = useState("QA_TC_Fork");
  const [owner, setOwner] = useState("TBD");
  const [env, setEnv] = useState("WEB-CHROME");
  const [maxTcPerRequirement, setMaxTcPerRequirement] = useState("2");
  const [variants, setVariants] = useState<VariantForm[]>([
    createVariant("A", "default"),
    createVariant("B", skills[1]?.id ?? "default"),
  ]);

  const updateVariant = (idx: number, patch: Partial<VariantForm>) => {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const addVariant = () => {
    if (variants.length >= 5) return;
    const letter = String.fromCharCode(65 + variants.length);
    setVariants((prev) => [...prev, createVariant(letter)]);
  };

  const removeVariant = (idx: number) => {
    if (variants.length <= 2) return;
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  };

  const bottomRef = useAutoScrollBottom([agents, result, error]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || variants.length < 2) return;

    run({
      spreadsheetUrl: url.trim(),
      baseSheetName: baseSheet,
      ownerDefault: owner,
      environmentDefault: env,
      maxTcPerRequirement: Number(maxTcPerRequirement),
      variants: variants.map((v) => ({
        label: v.label,
        skillId: v.skillId,
        domainMode: v.domainMode,
        domainScope: v.domainScope,
        maxFallbackRounds: Number(v.maxFallbackRounds),
      })),
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="space-y-1 text-sm text-zinc-600">
          <p className="font-medium text-zinc-800">{t("fork.info.title")}</p>
          <p>
            {t("fork.info.desc1")}
            {" "}
            {t("fork.info.desc2")}
          </p>
          <p className="text-xs text-zinc-500">{t("fork.info.variantHint")}</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            id="fork-url"
            label="Google Sheets URL"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              id="fork-baseSheet"
              label={t("fork.label.baseSheet")}
              value={baseSheet}
              onChange={(e) => setBaseSheet(e.target.value)}
            />
            <Input
              id="fork-owner"
              label={t("fork.label.owner")}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
            <Input
              id="fork-env"
              label={t("fork.label.environment")}
              value={env}
              onChange={(e) => setEnv(e.target.value)}
            />
            <Select
              id="fork-maxTcPerRequirement"
              label={t("fork.label.maxTcPerRequirement")}
              options={maxTcPerReqOptions}
              value={maxTcPerRequirement}
              onChange={(e) => setMaxTcPerRequirement(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Variants ({variants.length}/5)
              </h3>
              <Button
                type="button"
                variant="secondary"
                onClick={addVariant}
                disabled={variants.length >= 5}
              >
                <Plus className="h-4 w-4" />
                {t("fork.button.add")}
              </Button>
            </div>

            {variants.map((v, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 items-end gap-3 rounded-md border border-border bg-surface-alt p-3 sm:grid-cols-2 lg:grid-cols-[72px_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_88px_36px]"
              >
                <Input
                  id={`v-label-${idx}`}
                  label={idx === 0 ? t("fork.label.label") : undefined}
                  value={v.label}
                  onChange={(e) => updateVariant(idx, { label: e.target.value })}
                />
                {skillOptions.length > 0 ? (
                  <Select
                    id={`v-skill-${idx}`}
                    label={idx === 0 ? "Skill" : undefined}
                    options={skillOptions}
                    value={v.skillId}
                    onChange={(e) => updateVariant(idx, { skillId: e.target.value })}
                  />
                ) : (
                  <Input
                    id={`v-skill-${idx}`}
                    label={idx === 0 ? "Skill ID" : undefined}
                    value={v.skillId}
                    onChange={(e) => updateVariant(idx, { skillId: e.target.value })}
                  />
                )}
                <Select
                  id={`v-domainMode-${idx}`}
                  label={idx === 0 ? t("fork.label.domainMode") : undefined}
                  options={[
                    { value: "preset", label: t("fork.domainMode.preset") },
                    { value: "discovered", label: t("fork.domainMode.discovered") },
                  ]}
                  value={v.domainMode}
                  onChange={(e) => {
                    const m = e.target.value as "preset" | "discovered";
                    updateVariant(idx, {
                      domainMode: m,
                      ...(m === "discovered" ? { domainScope: "ALL" } : {}),
                    });
                  }}
                />
                <Select
                  id={`v-domain-${idx}`}
                  label={idx === 0 ? t("fork.label.domain") : undefined}
                  options={domainOptions}
                  value={v.domainScope}
                  disabled={v.domainMode === "discovered"}
                  onChange={(e) => updateVariant(idx, { domainScope: e.target.value })}
                />
                <Select
                  id={`v-fallback-${idx}`}
                  label={idx === 0 ? "Fallback" : undefined}
                  options={fallbackOptions}
                  value={v.maxFallbackRounds}
                  onChange={(e) => updateVariant(idx, { maxFallbackRounds: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeVariant(idx)}
                  disabled={variants.length <= 2}
                  className="mb-0.5 rounded p-1.5 text-zinc-400 transition-colors hover:bg-white hover:text-danger disabled:opacity-30"
                  aria-label={t("fork.button.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !url.trim() || variants.length < 2}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t("fork.button.running") : t("fork.button.run")}
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
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="rounded bg-surface-alt px-2 py-1 font-mono text-xs text-zinc-500">
              fork#{result.forkId}
            </span>
            <span className="text-xs text-zinc-400">
              {new Date(result.completedAt).toLocaleString("ko-KR")}
            </span>
          </div>
          <ForkComparison results={result.results} />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

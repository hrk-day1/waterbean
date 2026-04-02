import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "@/shared/lib/api-client";

interface DomainDistribution {
  Auth: number;
  Payment: number;
  Content: number;
  Membership: number;
  Community: number;
  Creator: number;
  Admin: number;
}

interface PriorityDistribution {
  P0: number;
  P1: number;
  P2: number;
}

interface TypeDistribution {
  Functional: number;
  Negative: number;
  Boundary: number;
  Regression: number;
  Accessibility: number;
  Security: number;
}

interface EvaluationIssue {
  type: string;
  message: string;
}

interface PipelineStats {
  totalTCs: number;
  domainDistribution: DomainDistribution;
  priorityDistribution: PriorityDistribution;
  typeDistribution: TypeDistribution;
  coverageGaps: string[];
  mappingGaps: string[];
}

export interface PipelineResult {
  success: boolean;
  sheetName: string;
  rounds: number;
  stats: PipelineStats;
  evaluationIssues: EvaluationIssue[];
}

export interface PipelineRequest {
  spreadsheetUrl: string;
  targetSheetName: string;
  domainScope: string;
  ownerDefault: string;
  environmentDefault: string;
  maxFallbackRounds: number;
  skillId: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
}

export function useSkills() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillSummary[]>([]);

  useEffect(() => {
    apiGet<SkillSummary[]>("/pipeline/skills")
      .then(setSkills)
      .catch(() => setSkills([{ id: "default", name: t("error.defaultSkill"), description: "" }]));
  }, [t]);

  return skills;
}

export function usePipeline() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (request: PipelineRequest) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPost<PipelineResult>("/pipeline/run", request);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.unknown"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  return { run, loading, result, error };
}

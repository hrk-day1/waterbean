import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/shared/lib/api-client";

interface ForkVariant {
  label: string;
  skillId: string;
  domainScope: string;
  maxFallbackRounds: number;
}

interface DomainDistribution {
  Auth: number;
  Payment: number;
  Content: number;
  Membership: number;
  Community: number;
  Creator: number;
  Admin: number;
}

interface PipelineStats {
  totalTCs: number;
  domainDistribution: DomainDistribution;
  priorityDistribution: { P0: number; P1: number; P2: number };
  typeDistribution: Record<string, number>;
  coverageGaps: string[];
  mappingGaps: string[];
}

interface EvaluationIssue {
  type: string;
  message: string;
}

interface PipelineResult {
  success: boolean;
  sheetName: string;
  rounds: number;
  stats: PipelineStats;
  evaluationIssues: EvaluationIssue[];
}

export interface ForkVariantResult {
  label: string;
  result: PipelineResult;
}

export interface ForkResult {
  forkId: string;
  completedAt: string;
  results: ForkVariantResult[];
}

export interface ForkRequest {
  spreadsheetUrl: string;
  baseSheetName: string;
  ownerDefault: string;
  environmentDefault: string;
  variants: ForkVariant[];
}

export function useFork() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (request: ForkRequest) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPost<ForkResult>("/pipeline/fork", request);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.unknown"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  return { run, loading, result, error };
}

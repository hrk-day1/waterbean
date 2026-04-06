import type { DomainMode, PipelineResult } from "./pipeline.js";

export interface ForkVariant {
  label: string;
  skillId: string;
  domainMode?: DomainMode;
  domainScope: string;
  maxFallbackRounds: number;
}

export interface ForkRequest {
  spreadsheetUrl: string;
  baseSheetName: string;
  ownerDefault: string;
  environmentDefault: string;
  maxTcPerRequirement?: number;
  highRiskMaxTcPerRequirement?: number;
  variants: ForkVariant[];
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

import type { ChecklistItem, Domain, Priority, TestCase, TcType } from "./tc.js";

export interface PipelineConfig {
  spreadsheetUrl: string;
  sourceSheetName?: string;
  sourceGid?: string;
  targetSheetName: string;
  domainScope: "ALL" | "AUTH" | "PAY" | "CONTENT" | "MEMBERSHIP" | "COMMUNITY" | "CREATOR" | "ADMIN";
  ownerDefault: string;
  environmentDefault: string;
  maxTcPerRequirement?: number;
  maxFallbackRounds: number;
  skillId: string;
}

export interface PlanResult {
  checklist: ChecklistItem[];
  sourceSheetName: string;
  totalSourceRows: number;
}

export interface GeneratorResult {
  testCases: TestCase[];
}

export interface EvaluationIssue {
  type: "schema" | "required_field" | "domain_min" | "coverage" | "duplicate";
  message: string;
  details?: Record<string, unknown>;
}

export interface EvaluationResult {
  passed: boolean;
  totalTCs: number;
  issues: EvaluationIssue[];
  uncoveredItems: ChecklistItem[];
  stats: PipelineStats;
}

export interface PipelineStats {
  totalTCs: number;
  domainDistribution: Record<Domain, number>;
  priorityDistribution: Record<Priority, number>;
  typeDistribution: Record<TcType, number>;
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

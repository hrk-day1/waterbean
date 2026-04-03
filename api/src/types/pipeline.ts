import type { ChecklistItem, Priority, TestCase, TcType } from "./tc.js";

export type Implementation = "deterministic" | "llm";

export type DomainMode = "preset" | "discovered";

export interface PipelineConfig {
  spreadsheetUrl: string;
  sourceSheetName?: string;
  sourceGid?: string;
  targetSheetName: string;
  /** preset: 기존 스킬 7도메인 / discovered: Taxonomy LLM으로 동적 도메인 (MVP는 domainScope ALL만) */
  domainMode?: DomainMode;
  domainScope: "ALL" | "AUTH" | "PAY" | "CONTENT" | "MEMBERSHIP" | "COMMUNITY" | "CREATOR" | "ADMIN";
  ownerDefault: string;
  environmentDefault: string;
  maxTcPerRequirement?: number;
  maxFallbackRounds: number;
  skillId: string;
  implementation?: Implementation;
  maxLlmRounds?: number;
  mergeSimilarTestCases?: boolean;
}

export interface PlanResult {
  checklist: ChecklistItem[];
  sourceSheetName: string;
  totalSourceRows: number;
}

export interface GeneratorResult {
  testCases: TestCase[];
}

export type EvaluationIssueType =
  | "schema"
  | "required_field"
  | "domain_min"
  | "coverage"
  | "test_point_missing"
  | "duplicate"
  | "taxonomy_domain_count"
  | "taxonomy_keyword_quality"
  | "taxonomy_keyword_overlap"
  | "taxonomy_template_completeness"
  | "taxonomy_minsets"
  | "taxonomy_balance"
  | "taxonomy_llm";

export interface EvaluationIssue {
  type: EvaluationIssueType;
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

export interface TaxonomyEvaluationResult {
  passed: boolean;
  issues: EvaluationIssue[];
  suggestions: string[];
}

export interface PipelineStats {
  totalTCs: number;
  domainDistribution: Record<string, number>;
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
  /** LLM 응답 JSON 파싱 실패 시 서버가 채움; UI·로컬 디버깅용 (민감 데이터 포함 가능) */
  llmJsonFailureLog?: string;
}

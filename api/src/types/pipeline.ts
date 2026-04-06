import type { ChecklistItem, Priority, TestCase, TcType } from "./tc.js";

export type Implementation = "deterministic" | "llm";

export type DomainMode = "preset" | "discovered";

/** 결정적 Generator의 도메인 최소 세트 보완 TC를 어느 체크리스트 행에 부착할지 */
export type DomainMinSetFillMode = "round_robin" | "representative" | "off";

/** D-Evaluator: 스펙 근거·Traceability 검증 게이트 (기본 warn = passed에 영향 없음, block 시 차단) */
export type EvaluatorGateMode = "off" | "warn" | "block";

export interface EvaluateOptions {
  evalSpecGrounding: EvaluatorGateMode;
  evalTraceability: EvaluatorGateMode;
}

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
  /** specRiskTier high 행의 Requirement_ID당 TC 상한(미지정 시 env 기본) */
  highRiskMaxTcPerRequirement?: number;
  maxFallbackRounds: number;
  skillId: string;
  implementation?: Implementation;
  maxLlmRounds?: number;
  mergeSimilarTestCases?: boolean;
  /** 기본 round_robin. off면 보완 TC 생략(도메인 최소 세트 Evaluator 이슈 가능) */
  domainMinSetFill?: DomainMinSetFillMode;
  /** 기능설명 대비 TC 과다 패턴 탐지. 미지정 시 env 또는 warn */
  evalSpecGrounding?: EvaluatorGateMode;
  /** Traceability R행 vs 체크리스트 sourceRow 정합. 미지정 시 env 또는 warn */
  evalTraceability?: EvaluatorGateMode;
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
  | "taxonomy_llm"
  | "spec_ungrounded"
  | "traceability_mismatch";

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

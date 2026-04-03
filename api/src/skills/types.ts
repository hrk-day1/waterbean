import type { Domain, TcType } from "../types/tc.js";

export interface TcTemplate {
  type: TcType;
  scenarioSuffix: string;
  precondition: string;
  steps: string;
  expectedResult: string;
}

export interface PolicyHint {
  domain: string;
  hint: string;
  riskLevel?: "high" | "medium" | "low";
}

export interface PriorityRule {
  domain: Domain;
  types: TcType[];
  priority: "P0" | "P1" | "P2";
}

export interface SeverityRule {
  domain: Domain;
  types: TcType[];
  severity: "S1" | "S2" | "S3";
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  domainKeywords: Record<Domain, string[]>;
  /** @deprecated Phase 4에서 policyHints로 대체됨. 하위호환용으로 유지. */
  commonTemplates?: TcTemplate[];
  /** @deprecated Phase 4에서 policyHints로 대체됨. 하위호환용으로 유지. */
  templates?: Record<Domain, TcTemplate[]>;
  policyHints?: PolicyHint[];
  domainMinSets: Record<Domain, Record<TcType, number>>;
  priorityRules: PriorityRule[];
  severityRules: SeverityRule[];
}

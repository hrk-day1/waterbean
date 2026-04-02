import type { Domain, TcType } from "../types/tc.js";

export interface TcTemplate {
  type: TcType;
  scenarioSuffix: string;
  precondition: string;
  steps: string;
  expectedResult: string;
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
  templates: Record<Domain, TcTemplate[]>;
  domainMinSets: Record<Domain, Record<TcType, number>>;
  priorityRules: PriorityRule[];
  severityRules: SeverityRule[];
}

export const TC_COLUMNS = [
  "TC_ID",
  "Feature",
  "Requirement_ID",
  "Scenario",
  "Precondition",
  "Test_Steps",
  "Test_Data",
  "Expected_Result",
  "Priority",
  "Severity",
  "Type",
  "Environment",
  "Owner",
  "Status",
  "Automation_Candidate",
  "Traceability",
  "Notes",
] as const;

export type TcColumnName = (typeof TC_COLUMNS)[number];

export const TC_TYPES = [
  "Functional",
  "Negative",
  "Boundary",
  "Regression",
  "Accessibility",
  "Security",
] as const;

export type TcType = (typeof TC_TYPES)[number];

export type Priority = "P0" | "P1" | "P2";
export type Severity = "S1" | "S2" | "S3";

export const DOMAINS = [
  "Auth",
  "Payment",
  "Content",
  "Membership",
  "Community",
  "Creator",
  "Admin",
] as const;

export type Domain = (typeof DOMAINS)[number];

export interface TestCase {
  TC_ID: string;
  Feature: string;
  Requirement_ID: string;
  Scenario: string;
  Precondition: string;
  Test_Steps: string;
  Test_Data: string;
  Expected_Result: string;
  Priority: Priority;
  Severity: Severity;
  Type: TcType;
  Environment: string;
  Owner: string;
  Status: string;
  Automation_Candidate: string;
  Traceability: string;
  Notes: string;
}

export interface ChecklistItem {
  id: string;
  requirementId: string;
  feature: string;
  domain: Domain;
  description: string;
  sourceRow: number;
  sourceSheet: string;
  covered: boolean;
}

/** @deprecated domainMinSets는 이제 SkillManifest JSON에서 관리됩니다 (api/src/skills/presets/*.json) */

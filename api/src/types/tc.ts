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

export const FEATURE_TYPES = [
  "조회",
  "등록",
  "수정",
  "삭제",
  "상태전이",
  "승인반려",
  "권한제어",
  "파일처리",
  "결제금액",
  "스케줄배치",
  "외부연동",
] as const;

export type FeatureType = (typeof FEATURE_TYPES)[number];

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
  /** 특이사항이 있을 때만 작성 */
  Notes?: string;
}

export interface ChecklistItem {
  id: string;
  requirementId: string;
  feature: string;
  /** preset: Auth, Payment, … / discovered: Taxonomy 도메인 id */
  domain: string;
  description: string;
  sourceRow: number;
  sourceSheet: string;
  covered: boolean;
  /** @migration Phase 2 이후 FeatureItem으로 분리 예정 */
  featureTypes?: FeatureType[];
  /** @migration Phase 2 이후 FeatureItem으로 분리 예정 */
  precondition?: string;
  /** @migration Phase 2 이후 FeatureItem으로 분리 예정 — 대분류 > 중분류 > 소분류 */
  categoryPath?: string;
}

export interface TestPoint {
  id: string;
  featureItemId: string;
  pointType: string;
  intent: string;
  suggestedTcType: TcType;
  required: boolean;
}

/** @deprecated domainMinSets는 이제 SkillManifest JSON에서 관리됩니다 (api/src/skills/presets/*.json) */

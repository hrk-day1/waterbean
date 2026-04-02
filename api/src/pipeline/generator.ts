import type { ChecklistItem, Domain, Priority, Severity, TestCase, TcType } from "../types/tc.js";
import { DOMAINS } from "../types/tc.js";
import type { SkillManifest, TcTemplate, PriorityRule, SeverityRule } from "../skills/types.js";

interface GeneratorConfig {
  ownerDefault: string;
  environmentDefault: string;
  maxTcPerRequirement?: number;
}

function determinePriority(
  domain: Domain,
  type: TcType,
  rules: PriorityRule[],
): Priority {
  for (const rule of rules) {
    if (rule.domain === domain && rule.types.includes(type)) {
      return rule.priority;
    }
  }
  if (type === "Negative" || type === "Boundary") return "P1";
  return "P2";
}

function determineSeverity(
  domain: Domain,
  type: TcType,
  rules: SeverityRule[],
): Severity {
  if (type === "Security") return "S1";
  for (const rule of rules) {
    if (rule.domain === domain && rule.types.includes(type)) {
      return rule.severity;
    }
  }
  if (type === "Functional" || type === "Negative") return "S2";
  return "S3";
}

export function generateTestCases(
  checklist: ChecklistItem[],
  config: GeneratorConfig,
  skill: SkillManifest,
): TestCase[] {
  const testCases: TestCase[] = [];
  let tcCounter = 1;

  const domainCounts = Object.fromEntries(
    DOMAINS.map((d) => [
      d,
      Object.fromEntries(
        ["Functional", "Negative", "Boundary", "Security", "Regression", "Accessibility"].map((t) => [t, 0]),
      ),
    ]),
  ) as Record<Domain, Record<TcType, number>>;

  for (const item of checklist) {
    const templates = skill.templates[item.domain] ?? [];
    const applicableTemplates = config.maxTcPerRequirement
      ? templates.slice(0, config.maxTcPerRequirement)
      : templates;

    for (const tmpl of applicableTemplates) {
      const tcId = `TC-${String(tcCounter++).padStart(4, "0")}`;
      const notes: string[] = [];

      if (item.feature === "UNKNOWN_FEATURE") notes.push("MAPPING_GAP:Feature");
      if (item.requirementId.startsWith("AUTO-")) notes.push("MAPPING_GAP:Requirement_ID");

      testCases.push({
        TC_ID: tcId,
        Feature: item.feature,
        Requirement_ID: item.requirementId,
        Scenario: `[${item.feature}] ${tmpl.scenarioSuffix}`,
        Precondition: tmpl.precondition,
        Test_Steps: tmpl.steps,
        Test_Data: "",
        Expected_Result: tmpl.expectedResult,
        Priority: determinePriority(item.domain, tmpl.type, skill.priorityRules),
        Severity: determineSeverity(item.domain, tmpl.type, skill.severityRules),
        Type: tmpl.type,
        Environment: config.environmentDefault,
        Owner: config.ownerDefault,
        Status: "Draft",
        Automation_Candidate: "N",
        Traceability: `${item.sourceSheet}!R${item.sourceRow}`,
        Notes: notes.join("; "),
      });

      domainCounts[item.domain][tmpl.type]++;
    }

    item.covered = true;
  }

  ensureDomainMinSets(testCases, domainCounts, checklist, config, skill, tcCounter);

  return deduplicateTestCases(testCases);
}

function ensureDomainMinSets(
  testCases: TestCase[],
  counts: Record<Domain, Record<TcType, number>>,
  checklist: ChecklistItem[],
  config: GeneratorConfig,
  skill: SkillManifest,
  startId: number,
) {
  let tcCounter = startId;

  for (const domain of DOMAINS) {
    const minSet = skill.domainMinSets[domain];
    if (!minSet) continue;

    const representative = checklist.find((c) => c.domain === domain);
    if (!representative) continue;

    const templates: TcTemplate[] = skill.templates[domain] ?? [];

    for (const [type, minCount] of Object.entries(minSet)) {
      const current = counts[domain][type as TcType];
      if (current >= minCount) continue;

      const gap = minCount - current;
      const matchingTemplates = templates.filter((t) => t.type === type);

      for (let i = 0; i < gap && i < matchingTemplates.length; i++) {
        const tmpl = matchingTemplates[i];
        const tcId = `TC-${String(tcCounter++).padStart(4, "0")}`;

        testCases.push({
          TC_ID: tcId,
          Feature: representative.feature,
          Requirement_ID: representative.requirementId,
          Scenario: `[${representative.feature}] ${tmpl.scenarioSuffix} (도메인 최소세트 보완)`,
          Precondition: tmpl.precondition,
          Test_Steps: tmpl.steps,
          Test_Data: "",
          Expected_Result: tmpl.expectedResult,
          Priority: determinePriority(domain, tmpl.type, skill.priorityRules),
          Severity: determineSeverity(domain, tmpl.type, skill.severityRules),
          Type: tmpl.type,
          Environment: config.environmentDefault,
          Owner: config.ownerDefault,
          Status: "Draft",
          Automation_Candidate: "N",
          Traceability: `${representative.sourceSheet}!R${representative.sourceRow}`,
          Notes: "도메인 최소세트 보완 TC",
        });
      }
    }
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function deduplicateTestCases(testCases: TestCase[]): TestCase[] {
  const seen = new Set<string>();
  return testCases.filter((tc) => {
    const key = `${normalize(tc.Feature)}|${normalize(tc.Scenario)}|${tc.Type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

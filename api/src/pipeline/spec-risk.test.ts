import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  combinedTextForRisk,
  deriveHighRiskExtraTemplates,
  inferSpecRiskTier,
} from "./spec-risk.js";
import type { ChecklistItem } from "../types/tc.js";

describe("inferSpecRiskTier", () => {
  it("classifies financial and transaction copy as high", () => {
    assert.equal(inferSpecRiskTier("멤버십 상품 가격 정보 VAT 포함"), "high");
    assert.equal(inferSpecRiskTier("거래 내역이 존재합니다 가격 변경 불가"), "high");
    assert.equal(inferSpecRiskTier("가입 인원 제한 100명"), "high");
  });

  it("classifies generic list copy as standard", () => {
    assert.equal(inferSpecRiskTier("포스트 목록 조회 페이지네이션"), "standard");
    assert.equal(inferSpecRiskTier("공지사항 제목 표시"), "standard");
  });
});

describe("combinedTextForRisk", () => {
  it("joins feature description and precondition", () => {
    const item = {
      feature: "A > B",
      description: "설명",
      precondition: "pc",
    } as ChecklistItem;
    assert.ok(combinedTextForRisk(item).includes("A > B"));
    assert.ok(combinedTextForRisk(item).includes("설명"));
    assert.ok(combinedTextForRisk(item).includes("pc"));
  });
});

describe("deriveHighRiskExtraTemplates", () => {
  it("returns extras only when sub-patterns match", () => {
    const withSales = deriveHighRiskExtraTemplates("이미 판매된 상품은 가격 수정 불가");
    assert.ok(withSales.some((t) => t.pointType === "거래이력제약"));

    const none = deriveHighRiskExtraTemplates("단순 목록 화면");
    assert.equal(none.length, 0);
  });
});

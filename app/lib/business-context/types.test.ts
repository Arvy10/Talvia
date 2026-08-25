import { describe, expect, it } from "vitest";
import { validateBusinessAnalysisResult } from "./types";

const validResult = {
  companyName: "Acme SAS",
  businessDescription: "Édite un logiciel de facturation pour PME.",
  services: ["Facturation", "Support"],
  products: [],
  keywords: ["facturation", "PME"],
  language: "fr",
  industry: { value: "Logiciel", provenance: "fact", confidence: 0.9 },
  valueProposition: { value: "Facturer plus vite", provenance: "inference", confidence: 0.6 },
  customerType: { value: "b2b", provenance: "inference", confidence: 0.8 },
  targetCustomers: { value: ["PME"], provenance: "fact", confidence: 0.8 },
  targetIndustries: { value: [], provenance: "inference", confidence: 0.3 },
  targetCompanySizes: { value: ["10-50"], provenance: "inference", confidence: 0.5 },
  targetRoles: { value: ["CFO"], provenance: "inference", confidence: 0.4 },
  geographies: { value: ["France"], provenance: "fact", confidence: 0.7 },
  painPoints: { value: ["Facturation manuelle lente"], provenance: "suggestion", confidence: 0.5 },
  salesAngles: { value: ["Gain de temps"], provenance: "suggestion", confidence: 0.5 },
  insufficientContent: false,
};

describe("validateBusinessAnalysisResult", () => {
  it("accepts a well-formed result", () => {
    expect(validateBusinessAnalysisResult(validResult)).not.toBeNull();
  });
  it("rejects null/non-object input", () => {
    expect(validateBusinessAnalysisResult(null)).toBeNull();
    expect(validateBusinessAnalysisResult("x")).toBeNull();
  });
  it("rejects a missing scored field", () => {
    const { industry, ...rest } = validResult;
    expect(validateBusinessAnalysisResult(rest)).toBeNull();
  });
  it("rejects a scored field missing provenance", () => {
    expect(
      validateBusinessAnalysisResult({ ...validResult, industry: { value: "Logiciel", confidence: 0.9 } }),
    ).toBeNull();
  });
  it("rejects a scored field with an invalid provenance value", () => {
    expect(
      validateBusinessAnalysisResult({ ...validResult, industry: { value: "Logiciel", provenance: "guess", confidence: 0.9 } }),
    ).toBeNull();
  });
  it("rejects an AI-generated result claiming user_provided provenance (that provenance is reserved for human edits)", () => {
    expect(
      validateBusinessAnalysisResult({ ...validResult, industry: { value: "Logiciel", provenance: "user_provided", confidence: 1 } }),
    ).toBeNull();
  });
  it("rejects a missing customerType", () => {
    const { customerType, ...rest } = validResult;
    expect(validateBusinessAnalysisResult(rest)).toBeNull();
  });
  it("rejects a customerType value outside b2b/b2c/both", () => {
    expect(
      validateBusinessAnalysisResult({ ...validResult, customerType: { value: "enterprise", provenance: "inference", confidence: 0.8 } }),
    ).toBeNull();
  });
  it("rejects a scored array field whose value is not a string array", () => {
    expect(
      validateBusinessAnalysisResult({ ...validResult, targetCustomers: { value: "PME", provenance: "fact", confidence: 0.8 } }),
    ).toBeNull();
  });
  it("rejects confidence outside 0..1", () => {
    expect(
      validateBusinessAnalysisResult({ ...validResult, industry: { value: "Logiciel", provenance: "fact", confidence: 1.5 } }),
    ).toBeNull();
  });
});

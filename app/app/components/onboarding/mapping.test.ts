import { describe, expect, it } from "vitest";
import type { BusinessContextRecord } from "../../../lib/business-context/business-context-service";
import { businessContextToSummaryData, manualEntryToEditInput } from "./mapping";
import { emptyManualEntryValues, type ManualEntryValues } from "./ManualEntryFlow";

function minimalValues(overrides: Partial<ManualEntryValues> = {}): ManualEntryValues {
  return {
    ...emptyManualEntryValues(),
    companyName: "Fayluméa",
    businessDescription: "Nous créons des sites web pour les entreprises.",
    offers: ["Site web"],
    customerTypeLabel: "Entreprises",
    ...overrides,
  };
}

describe("manualEntryToEditInput", () => {
  it("maps the required minimum onboarding fields", () => {
    const input = manualEntryToEditInput(minimalValues());
    expect(input.companyName).toBe("Fayluméa");
    expect(input.businessDescription).toBe("Nous créons des sites web pour les entreprises.");
    expect(input.services).toEqual(["Site web"]);
    expect(input.customerType).toBe("b2b");
  });

  it("maps Particuliers to b2c and Les deux to both", () => {
    expect(manualEntryToEditInput(minimalValues({ customerTypeLabel: "Particuliers" })).customerType).toBe("b2c");
    expect(manualEntryToEditInput(minimalValues({ customerTypeLabel: "Les deux" })).customerType).toBe("both");
  });

  it("omits every optional field the user left empty, rather than sending an empty value", () => {
    const input = manualEntryToEditInput(minimalValues());
    // Skipped in the onboarding: industry, target company types, company
    // sizes, target roles, target industries, geographies, main problem.
    // These must come out `undefined` — sending `[]`/`""` would mark them
    // manuallyEditedFields and permanently block future AI enrichment.
    expect(input.industry).toBeUndefined();
    expect(input.targetCustomers).toBeUndefined();
    expect(input.targetCompanySizes).toBeUndefined();
    expect(input.targetRoles).toBeUndefined();
    expect(input.targetIndustries).toBeUndefined();
    expect(input.geographies).toBeUndefined();
    expect(input.painPoints).toBeUndefined();
  });

  it("creates a valid profile without a value proposition, keywords, or sales angles — those are AI/backend concerns, never onboarding fields", () => {
    const input = manualEntryToEditInput(minimalValues());
    expect(input).not.toHaveProperty("valueProposition");
    expect(input).not.toHaveProperty("keywords");
    expect(input).not.toHaveProperty("salesAngles");
  });

  it("sends an explicit empty array for targetIndustries when the user picks 'Tous secteurs' (a real answer, not a skip)", () => {
    const input = manualEntryToEditInput(minimalValues({ allIndustries: true, targetIndustries: ["Devrait être ignoré"] }));
    expect(input.targetIndustries).toEqual([]);
  });

  it("maps the recommended/advanced target fields when the user does fill them in", () => {
    const input = manualEntryToEditInput(minimalValues({
      targetCompanyTypes: ["PME", "Startups"],
      companySizes: ["Petites entreprises"],
      targetRoles: ["Fondateur / Dirigeant"],
      geographies: ["Congo"],
      mainProblem: "Manque de visibilité en ligne.",
    }));
    expect(input.targetCustomers).toEqual(["PME", "Startups"]);
    expect(input.targetCompanySizes).toEqual(["Petites entreprises"]);
    expect(input.targetRoles).toEqual(["Fondateur / Dirigeant"]);
    expect(input.geographies).toEqual(["Congo"]);
    expect(input.painPoints).toEqual(["Manque de visibilité en ligne."]);
  });
});

describe("businessContextToSummaryData", () => {
  const baseRecord: BusinessContextRecord = {
    id: "ctx-1",
    status: "ready",
    errorReason: null,
    website: "https://entreprise.com",
    companyName: "Entreprise SAS",
    industry: { value: "Logiciel", provenance: "inference", confidence: 0.7 },
    businessDescription: "Édite un logiciel.",
    valueProposition: null,
    customerType: { value: "b2b", provenance: "inference", confidence: 0.6 },
    services: ["Facturation", "Support"],
    products: [],
    targetCustomers: { value: ["PME"], provenance: "fact", confidence: 0.8 },
    targetIndustries: null,
    targetCompanySizes: { value: ["Petites entreprises"], provenance: "inference", confidence: 0.5 },
    targetRoles: null,
    geographies: { value: ["France"], provenance: "fact", confidence: 0.7 },
    keywords: [],
    painPoints: { value: ["Manque de visibilité"], provenance: "suggestion", confidence: 0.5 },
    salesAngles: null,
    primaryLanguage: "fr",
    source: "website_analysis",
    analysisVersion: "1",
    sourcePages: ["https://entreprise.com"],
    manuallyEditedFields: [],
    aiModel: "test-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("condenses a full record into the same lightweight shape the manual flow produces", () => {
    const summary = businessContextToSummaryData(baseRecord);
    expect(summary.companyName).toBe("Entreprise SAS");
    expect(summary.offers).toEqual(["Facturation", "Support"]);
    expect(summary.targetLabel).toBe("PME · Petites entreprises");
    expect(summary.geographyLabel).toBe("France");
    expect(summary.mainProblem).toBe("Manque de visibilité");
  });

  it("falls back to the customerType label when no explicit target list was detected", () => {
    const summary = businessContextToSummaryData({ ...baseRecord, targetCustomers: null, targetCompanySizes: null });
    expect(summary.targetLabel).toBe("Entreprises");
  });
});

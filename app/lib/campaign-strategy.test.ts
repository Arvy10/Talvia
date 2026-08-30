import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessContextRecord } from "./business-context/business-context-service";

const generateStructuredMock = vi.hoisted(() => vi.fn());
const getAIProviderMock = vi.hoisted(() => vi.fn(() => null as { model: string; generateStructured: typeof generateStructuredMock } | null));
vi.mock("./ai", () => ({ getAIProvider: getAIProviderMock }));

const { generateCampaignStrategy, applyStrategyEdit, preserveManualStrategyFields, validateCampaignStrategy, InsufficientBusinessContextError } = await import("./campaign-strategy");

beforeEach(() => {
  generateStructuredMock.mockReset();
  getAIProviderMock.mockReset();
  getAIProviderMock.mockReturnValue(null);
});

function scored<T>(value: T) {
  return { value, provenance: "fact" as const, confidence: 0.9 };
}

function businessContext(overrides: Partial<BusinessContextRecord> = {}): BusinessContextRecord {
  return {
    id: "bc-1", status: "ready", errorReason: null, website: "https://acme.test", companyName: "Acme",
    industry: null, businessDescription: "Nous vendons un CRM pour agences.", valueProposition: null, customerType: null,
    services: [], products: [],
    targetCustomers: scored(["agences marketing"]), targetIndustries: scored(["marketing"]), targetCompanySizes: null,
    targetRoles: scored(["Directrice marketing", "CMO"]), geographies: scored(["France"]),
    keywords: [], painPoints: null, salesAngles: null, primaryLanguage: "fr", source: "website_analysis",
    analysisVersion: "1", sourcePages: [], manuallyEditedFields: [], aiModel: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("generateCampaignStrategy", () => {
  it("A. builds a structured strategy from Business Context fields when no AI provider is configured, unvalidated", async () => {
    getAIProviderMock.mockReturnValueOnce(null);
    const strategy = await generateCampaignStrategy(businessContext());

    expect(strategy.targetRoles).toEqual(["Directrice marketing", "CMO"]);
    expect(strategy.industries).toEqual(["marketing"]);
    expect(strategy.geography).toEqual(["France"]);
    expect(strategy.source).toBe("ai_generated");
    expect(strategy.aiModel).toBeNull();
    // A. strategy generated -> unvalidated.
    expect(strategy.validatedAt).toBeNull();
  });

  it("A. uses the AI provider's structured output when configured, tagging the model used", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      data: { objective: "Cibler les CMO de PME SaaS.", targetDescription: "CMO", targetRoles: ["CMO"], companyTypes: ["PME SaaS"], industries: ["SaaS"], geography: ["France"], qualificationCriteria: ["Budget marketing"], exclusionCriteria: [], reasoning: "Fondé sur le profil." },
      model: "test-model",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    getAIProviderMock.mockReturnValueOnce({ model: "test-model", generateStructured: generateStructuredMock });

    const strategy = await generateCampaignStrategy(businessContext());

    expect(strategy.targetRoles).toEqual(["CMO"]);
    expect(strategy.aiModel).toBe("test-model");
    // Never calls Gemini/Anthropic directly — only through the injected
    // provider-agnostic abstraction (docs spec §5).
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("B. refuses to propose a strategy from an insufficient Business Context, instead of fabricating one", async () => {
    const thin = businessContext({ companyName: null, businessDescription: null, targetRoles: null, targetIndustries: null, targetCustomers: null });

    await expect(generateCampaignStrategy(thin)).rejects.toBeInstanceOf(InsufficientBusinessContextError);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("B. refuses on a null Business Context (never onboarded)", async () => {
    await expect(generateCampaignStrategy(null)).rejects.toBeInstanceOf(InsufficientBusinessContextError);
  });

  it("falls back to the deterministic strategy when the AI provider call fails, rather than blocking generation", async () => {
    generateStructuredMock.mockRejectedValueOnce(new Error("provider down"));
    getAIProviderMock.mockReturnValueOnce({ model: "test-model", generateStructured: generateStructuredMock });

    const strategy = await generateCampaignStrategy(businessContext());

    expect(strategy.aiModel).toBeNull();
    expect(strategy.targetRoles).toEqual(["Directrice marketing", "CMO"]);
  });
});

describe("applyStrategyEdit / preserveManualStrategyFields / validateCampaignStrategy", () => {
  it("C. a human edit is recorded as manually-edited and flips the strategy's source", () => {
    const original = { objective: "o", targetDescription: "t", targetRoles: ["A"], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r", source: "ai_generated" as const, manuallyEditedFields: [], generatedAt: "now", aiModel: "m", validatedAt: null };

    const edited = applyStrategyEdit(original, { targetRoles: ["Directrice commerciale"] });

    expect(edited.targetRoles).toEqual(["Directrice commerciale"]);
    expect(edited.manuallyEditedFields).toContain("targetRoles");
    expect(edited.source).toBe("user_edited");
    // Untouched fields are preserved as-is.
    expect(edited.objective).toBe("o");
  });

  it("D. editing an already-validated strategy resets it to unvalidated", () => {
    const validated = { objective: "o", targetDescription: "t", targetRoles: ["A"], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r", source: "user_edited" as const, manuallyEditedFields: [], generatedAt: "now", aiModel: "m", validatedAt: "2026-01-01T00:00:00.000Z" };

    const edited = applyStrategyEdit(validated, { geography: ["Belgique"] });

    expect(edited.validatedAt).toBeNull();
  });

  it("C. a later regeneration never silently overwrites a field the user already corrected", () => {
    const edited = { objective: "o", targetDescription: "t", targetRoles: ["Directrice commerciale"], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r", source: "user_edited" as const, manuallyEditedFields: ["targetRoles"], generatedAt: "now", aiModel: "m", validatedAt: null };
    const fresh = { objective: "nouvel objectif", targetDescription: "nouvelle cible", targetRoles: ["CMO générique"], companyTypes: [], industries: ["SaaS"], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "raisonnement frais", source: "ai_generated" as const, manuallyEditedFields: [], generatedAt: "later", aiModel: "m2", validatedAt: null };

    const merged = preserveManualStrategyFields(edited, fresh);

    // The user-corrected field survives regeneration...
    expect(merged.targetRoles).toEqual(["Directrice commerciale"]);
    // ...but everything the user never touched picks up the fresh values.
    expect(merged.objective).toBe("nouvel objectif");
    expect(merged.industries).toEqual(["SaaS"]);
  });

  it("E. regenerating an already-validated strategy resets it to unvalidated, even if the user had corrected fields", () => {
    const validated = { objective: "o", targetDescription: "t", targetRoles: ["Directrice commerciale"], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r", source: "user_edited" as const, manuallyEditedFields: ["targetRoles"], generatedAt: "now", aiModel: "m", validatedAt: "2026-01-01T00:00:00.000Z" };
    const fresh = { objective: "nouvel objectif", targetDescription: "nouvelle cible", targetRoles: ["CMO générique"], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r2", source: "ai_generated" as const, manuallyEditedFields: [], generatedAt: "later", aiModel: "m2", validatedAt: null };

    const merged = preserveManualStrategyFields(validated, fresh);

    expect(merged.validatedAt).toBeNull();
    // The manual correction still survives — invalidating and preserving
    // edits are independent concerns.
    expect(merged.targetRoles).toEqual(["Directrice commerciale"]);
  });

  it("E. regenerating a never-edited strategy is also unvalidated", () => {
    const merged = preserveManualStrategyFields(null, { objective: "o", targetDescription: "t", targetRoles: [], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r", source: "ai_generated", manuallyEditedFields: [], generatedAt: "now", aiModel: null, validatedAt: null });
    expect(merged.validatedAt).toBeNull();
  });

  it("C. validateCampaignStrategy sets validatedAt on explicit user action only", () => {
    const unvalidated = { objective: "o", targetDescription: "t", targetRoles: [], companyTypes: [], industries: [], geography: [], qualificationCriteria: [], exclusionCriteria: [], reasoning: "r", source: "ai_generated" as const, manuallyEditedFields: [], generatedAt: "now", aiModel: null, validatedAt: null };

    const validated = validateCampaignStrategy(unvalidated);

    expect(validated.validatedAt).not.toBeNull();
    expect(typeof validated.validatedAt).toBe("string");
  });
});

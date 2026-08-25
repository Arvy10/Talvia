import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "../workspace-context";
import type { BusinessAnalysisResult } from "./types";

// business-context-service.ts talks to Postgres exclusively through
// `database.query` / `database.connect`. This fake understands only the
// handful of query shapes the service actually issues, and skips the
// analysis-runs rate-limit lookup entirely — rate limiting isn't what this
// file tests, and a real clock would make sequential calls flaky.
const JSON_COLUMNS = new Set([
  "services", "products", "keywords", "industry", "value_proposition",
  "target_customers", "target_industries", "target_company_sizes", "target_roles",
  "geographies", "pain_points", "sales_angles", "manually_edited_fields", "source_pages",
]);

function createFakeDatabase() {
  const contexts: Array<Record<string, unknown>> = [];
  let idCounter = 0;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text === "begin" || text === "commit" || text === "rollback") {
      return { rows: [] };
    }

    if (text.startsWith("select id,status")) {
      const workspaceId = params[0];
      const row = contexts.find((c) => c.workspace_id === workspaceId && c.is_active);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("update business_contexts set is_active=false")) {
      const workspaceId = params[0];
      for (const c of contexts) if (c.workspace_id === workspaceId && c.is_active) c.is_active = false;
      return { rows: [] };
    }

    if (text.startsWith("insert into business_contexts")) {
      const [
        workspaceId, status, errorReason, website, companyName, industry, businessDescription,
        valueProposition, services, products, targetCustomers, targetIndustries, targetCompanySizes,
        targetRoles, geographies, keywords, painPoints, salesAngles, primaryLanguage, source,
        analysisVersion, sourcePages, manuallyEditedFields, aiModel,
      ] = params as string[];
      const row: Record<string, unknown> = {
        id: `ctx-${(idCounter += 1)}`,
        workspace_id: workspaceId,
        is_active: true,
        status,
        error_reason: errorReason ?? null,
        website: website ?? null,
        company_name: companyName ?? null,
        industry: industry ? JSON.parse(industry) : null,
        business_description: businessDescription ?? null,
        value_proposition: valueProposition ? JSON.parse(valueProposition) : null,
        services: JSON.parse(services),
        products: JSON.parse(products),
        target_customers: targetCustomers ? JSON.parse(targetCustomers) : null,
        target_industries: targetIndustries ? JSON.parse(targetIndustries) : null,
        target_company_sizes: targetCompanySizes ? JSON.parse(targetCompanySizes) : null,
        target_roles: targetRoles ? JSON.parse(targetRoles) : null,
        geographies: geographies ? JSON.parse(geographies) : null,
        keywords: JSON.parse(keywords),
        pain_points: painPoints ? JSON.parse(painPoints) : null,
        sales_angles: salesAngles ? JSON.parse(salesAngles) : null,
        primary_language: primaryLanguage ?? null,
        source,
        analysis_version: analysisVersion ?? null,
        source_pages: JSON.parse(sourcePages),
        manually_edited_fields: JSON.parse(manuallyEditedFields),
        ai_model: aiModel ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      contexts.push(row);
      return { rows: [row] };
    }

    if (text.startsWith("select created_at from business_context_analysis_runs")) {
      return { rows: [] }; // rate-limit lookup intentionally short-circuited, see header comment
    }

    if (text.startsWith("insert into business_context_analysis_runs")) {
      return { rows: [] };
    }

    if (text.startsWith("update business_contexts set")) {
      const workspaceId = params[params.length - 2];
      const id = params[params.length - 1];
      const row = contexts.find((c) => c.workspace_id === workspaceId && c.id === id);
      if (!row) return { rows: [] };

      const setPart = text.slice(text.indexOf("set ") + 4, text.indexOf(" where"));
      let paramIndex = 0;
      for (const assignment of setPart.split(",").map((part) => part.trim())) {
        const [column, rhs] = assignment.split("=");
        if (rhs!.startsWith("$")) {
          const value = params[paramIndex] as string;
          paramIndex += 1;
          row[column!] = JSON_COLUMNS.has(column!) ? JSON.parse(value) : value;
        } else if (rhs === "null") {
          row[column!] = null;
        } else if (rhs === "now()") {
          row[column!] = new Date().toISOString();
        } else {
          row[column!] = rhs!.replace(/^'|'$/g, "");
        }
      }
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }

    throw new Error(`Unhandled query in fake database: ${text}`);
  }

  return {
    query,
    connect: async () => ({ query, release: () => {} }),
  };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

const analyzeMock = vi.fn();
vi.mock("./business-analyzer", () => ({ analyzeBusinessFromWebsite: (...args: unknown[]) => analyzeMock(...args) }));

const { getActiveBusinessContext, runBusinessContextAnalysis, startManualBusinessContext, updateActiveBusinessContext } = await import("./business-context-service");

const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId: "ws-1", role: "owner" };

function analysisResult(overrides: Partial<BusinessAnalysisResult> = {}): BusinessAnalysisResult {
  return {
    companyName: "Entreprise SAS",
    businessDescription: "Édite un logiciel pour PME.",
    services: ["Support"],
    products: [],
    keywords: ["logiciel"],
    language: "fr",
    industry: { value: "Logiciel", provenance: "fact", confidence: 0.9 },
    valueProposition: { value: "Facturer plus vite", provenance: "inference", confidence: 0.6 },
    targetCustomers: { value: ["PME"], provenance: "fact", confidence: 0.8 },
    targetIndustries: { value: [], provenance: "inference", confidence: 0.3 },
    targetCompanySizes: { value: [], provenance: "inference", confidence: 0.3 },
    targetRoles: { value: [], provenance: "inference", confidence: 0.3 },
    geographies: { value: ["France"], provenance: "fact", confidence: 0.7 },
    painPoints: { value: [], provenance: "suggestion", confidence: 0.5 },
    salesAngles: { value: [], provenance: "suggestion", confidence: 0.5 },
    insufficientContent: false,
    ...overrides,
  };
}

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  analyzeMock.mockReset();
});

describe("business context service", () => {
  it("creates a manual profile without requiring a website", async () => {
    const record = await startManualBusinessContext(context);
    expect(record.status).toBe("ready");
    expect(record.source).toBe("manual");
    expect(record.website).toBeNull();
  });

  it("marks a human correction as user_provided, not fact", async () => {
    await startManualBusinessContext(context);
    const record = await updateActiveBusinessContext(context, { targetCustomers: ["Cabinets médicaux"] });
    expect(record?.targetCustomers?.provenance).toBe("user_provided");
    expect(record?.targetCustomers?.confidence).toBe(1);
    expect(record?.targetCustomers?.value).toEqual(["Cabinets médicaux"]);
  });

  it("persists a human correction across a re-fetch (settings round trip)", async () => {
    await startManualBusinessContext(context);
    await updateActiveBusinessContext(context, { companyName: "Cabinet Dupont" });
    const reloaded = await getActiveBusinessContext(context);
    expect(reloaded?.companyName).toBe("Cabinet Dupont");
  });

  it("does not silently overwrite a manually corrected field on the next analysis", async () => {
    analyzeMock.mockResolvedValue({
      status: "ready",
      result: analysisResult({ targetCustomers: { value: ["PME"], provenance: "fact", confidence: 0.8 } }),
      model: "test-model",
      usage: { inputTokens: 10, outputTokens: 10 },
      sourcePages: ["https://entreprise.com"],
      contentChars: 500,
      pagesFetched: 1,
    });

    await runBusinessContextAnalysis(context, "https://entreprise.com");
    await updateActiveBusinessContext(context, { targetCustomers: ["Cabinets médicaux"] });

    // Second analysis re-detects the same "PME" the model saw the first time.
    analyzeMock.mockResolvedValue({
      status: "ready",
      result: analysisResult({
        companyName: "Entreprise SAS (mise à jour)",
        targetCustomers: { value: ["PME"], provenance: "fact", confidence: 0.85 },
      }),
      model: "test-model",
      usage: { inputTokens: 10, outputTokens: 10 },
      sourcePages: ["https://entreprise.com"],
      contentChars: 520,
      pagesFetched: 1,
    });
    await runBusinessContextAnalysis(context, "https://entreprise.com");

    const record = await getActiveBusinessContext(context);
    expect(record?.targetCustomers?.value).toEqual(["Cabinets médicaux"]);
    expect(record?.targetCustomers?.provenance).toBe("user_provided");
    // Untouched fields still pick up the fresh analysis.
    expect(record?.companyName).toBe("Entreprise SAS (mise à jour)");
    expect(record?.manuallyEditedFields).toContain("targetCustomers");
  });
});

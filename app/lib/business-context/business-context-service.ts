import { database } from "../database";
import type { WorkspaceContext } from "../workspace-context";
import { analyzeBusinessFromWebsite } from "./business-analyzer";
import type { BusinessAnalysisResult, ScoredField } from "./types";

const ANALYSIS_VERSION = "1";
const MIN_REANALYSIS_INTERVAL_MS = 60_000;

export type BusinessContextStatus = "pending" | "analyzing" | "ready" | "error" | "insufficient_content";

export type BusinessContextRecord = {
  id: string;
  status: BusinessContextStatus;
  errorReason: string | null;
  website: string | null;
  companyName: string | null;
  industry: ScoredField<string> | null;
  businessDescription: string | null;
  valueProposition: ScoredField<string> | null;
  services: string[];
  products: string[];
  targetCustomers: ScoredField<string[]> | null;
  targetIndustries: ScoredField<string[]> | null;
  targetCompanySizes: ScoredField<string[]> | null;
  targetRoles: ScoredField<string[]> | null;
  geographies: ScoredField<string[]> | null;
  keywords: string[];
  painPoints: ScoredField<string[]> | null;
  salesAngles: ScoredField<string[]> | null;
  primaryLanguage: string | null;
  source: "website_analysis" | "manual";
  analysisVersion: string | null;
  sourcePages: string[];
  manuallyEditedFields: string[];
  aiModel: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  status: BusinessContextStatus;
  error_reason: string | null;
  website: string | null;
  company_name: string | null;
  industry: ScoredField<string> | null;
  business_description: string | null;
  value_proposition: ScoredField<string> | null;
  services: string[];
  products: string[];
  target_customers: ScoredField<string[]> | null;
  target_industries: ScoredField<string[]> | null;
  target_company_sizes: ScoredField<string[]> | null;
  target_roles: ScoredField<string[]> | null;
  geographies: ScoredField<string[]> | null;
  keywords: string[];
  pain_points: ScoredField<string[]> | null;
  sales_angles: ScoredField<string[]> | null;
  primary_language: string | null;
  source: "website_analysis" | "manual";
  analysis_version: string | null;
  source_pages: string[];
  manually_edited_fields: string[];
  ai_model: string | null;
  created_at: string;
  updated_at: string;
};

function map(row: Row): BusinessContextRecord {
  return {
    id: row.id,
    status: row.status,
    errorReason: row.error_reason,
    website: row.website,
    companyName: row.company_name,
    industry: row.industry,
    businessDescription: row.business_description,
    valueProposition: row.value_proposition,
    services: row.services,
    products: row.products,
    targetCustomers: row.target_customers,
    targetIndustries: row.target_industries,
    targetCompanySizes: row.target_company_sizes,
    targetRoles: row.target_roles,
    geographies: row.geographies,
    keywords: row.keywords,
    painPoints: row.pain_points,
    salesAngles: row.sales_angles,
    primaryLanguage: row.primary_language,
    source: row.source,
    analysisVersion: row.analysis_version,
    sourcePages: row.source_pages,
    manuallyEditedFields: row.manually_edited_fields,
    aiModel: row.ai_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `select id,status,error_reason,website,company_name,industry,business_description,value_proposition,
  services,products,target_customers,target_industries,target_company_sizes,target_roles,geographies,keywords,
  pain_points,sales_angles,primary_language,source,analysis_version,source_pages,manually_edited_fields,ai_model,
  created_at,updated_at from business_contexts`;

export async function getActiveBusinessContext(context: WorkspaceContext): Promise<BusinessContextRecord | null> {
  const result = await database.query<Row>(`${SELECT} where workspace_id=$1 and is_active limit 1`, [context.workspaceId]);
  return result.rows[0] ? map(result.rows[0]) : null;
}

export class RateLimitedError extends Error {}

async function assertNotRateLimited(context: WorkspaceContext) {
  const result = await database.query<{ created_at: string }>(
    `select created_at from business_context_analysis_runs where workspace_id=$1 order by created_at desc limit 1`,
    [context.workspaceId],
  );
  const last = result.rows[0];
  if (last && Date.now() - new Date(last.created_at).getTime() < MIN_REANALYSIS_INTERVAL_MS) {
    throw new RateLimitedError("Une analyse a déjà été lancée récemment. Merci de patienter avant de relancer.");
  }
}

// Replaces the active row (partial unique index on workspace_id where
// is_active enforces exactly one) rather than updating in place, so every
// analysis run is a fresh, independently auditable record.
async function replaceActiveContext(
  context: WorkspaceContext,
  values: Partial<Row> & { status: BusinessContextStatus; website: string | null },
): Promise<BusinessContextRecord> {
  const client = await database.connect();
  try {
    await client.query("begin");
    await client.query(`update business_contexts set is_active=false where workspace_id=$1 and is_active`, [context.workspaceId]);
    const inserted = await client.query<Row>(
      `insert into business_contexts (
        workspace_id, is_active, status, error_reason, website, company_name, industry, business_description,
        value_proposition, services, products, target_customers, target_industries, target_company_sizes,
        target_roles, geographies, keywords, pain_points, sales_angles, primary_language, source,
        analysis_version, source_pages, manually_edited_fields, ai_model
      ) values ($1,true,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      returning *`,
      [
        context.workspaceId,
        values.status,
        values.error_reason ?? null,
        values.website,
        values.company_name ?? null,
        values.industry ? JSON.stringify(values.industry) : null,
        values.business_description ?? null,
        values.value_proposition ? JSON.stringify(values.value_proposition) : null,
        JSON.stringify(values.services ?? []),
        JSON.stringify(values.products ?? []),
        values.target_customers ? JSON.stringify(values.target_customers) : null,
        values.target_industries ? JSON.stringify(values.target_industries) : null,
        values.target_company_sizes ? JSON.stringify(values.target_company_sizes) : null,
        values.target_roles ? JSON.stringify(values.target_roles) : null,
        values.geographies ? JSON.stringify(values.geographies) : null,
        JSON.stringify(values.keywords ?? []),
        values.pain_points ? JSON.stringify(values.pain_points) : null,
        values.sales_angles ? JSON.stringify(values.sales_angles) : null,
        values.primary_language ?? null,
        values.source ?? "website_analysis",
        values.analysis_version ?? null,
        JSON.stringify(values.source_pages ?? []),
        JSON.stringify(values.manually_edited_fields ?? []),
        values.ai_model ?? null,
      ],
    );
    await client.query("commit");
    return map(inserted.rows[0]!);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function logRun(
  context: WorkspaceContext,
  businessContextId: string | null,
  website: string,
  status: "succeeded" | "failed" | "insufficient_content",
  fields: { pagesFetched: number; contentChars: number; durationMs: number; aiModel?: string | null; inputTokens?: number; outputTokens?: number; errorReason?: string },
) {
  await database.query(
    `insert into business_context_analysis_runs
      (workspace_id, business_context_id, website, status, pages_fetched, content_chars, duration_ms, ai_model, input_tokens, output_tokens, error_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      context.workspaceId,
      businessContextId,
      website,
      status,
      fields.pagesFetched,
      fields.contentChars,
      fields.durationMs,
      fields.aiModel ?? null,
      fields.inputTokens ?? null,
      fields.outputTokens ?? null,
      fields.errorReason ?? null,
    ],
  );
}

function toRowFields(result: BusinessAnalysisResult): Partial<Row> {
  return {
    company_name: result.companyName,
    industry: result.industry,
    business_description: result.businessDescription,
    value_proposition: result.valueProposition,
    services: result.services,
    products: result.products,
    target_customers: result.targetCustomers,
    target_industries: result.targetIndustries,
    target_company_sizes: result.targetCompanySizes,
    target_roles: result.targetRoles,
    geographies: result.geographies,
    keywords: result.keywords,
    pain_points: result.painPoints,
    sales_angles: result.salesAngles,
    primary_language: result.language,
  };
}

// Creates a blank active context for a workspace that skips website
// analysis entirely — the review screen is then filled in by hand.
export async function startManualBusinessContext(context: WorkspaceContext): Promise<BusinessContextRecord> {
  return replaceActiveContext(context, { status: "ready", website: null, source: "manual", analysis_version: ANALYSIS_VERSION });
}

export type BusinessContextEditInput = {
  companyName?: string;
  businessDescription?: string;
  services?: string[];
  products?: string[];
  keywords?: string[];
  primaryLanguage?: string;
  industry?: string;
  valueProposition?: string;
  targetCustomers?: string[];
  targetIndustries?: string[];
  targetCompanySizes?: string[];
  targetRoles?: string[];
  geographies?: string[];
  painPoints?: string[];
  salesAngles?: string[];
};

const SCORED_STRING_FIELDS = ["industry", "valueProposition"] as const;
const SCORED_ARRAY_FIELDS = ["targetCustomers", "targetIndustries", "targetCompanySizes", "targetRoles", "geographies", "painPoints", "salesAngles"] as const;
const PLAIN_FIELDS = ["companyName", "businessDescription", "services", "products", "keywords", "primaryLanguage"] as const;

const COLUMN_BY_FIELD: Record<string, string> = {
  companyName: "company_name",
  businessDescription: "business_description",
  services: "services",
  products: "products",
  keywords: "keywords",
  primaryLanguage: "primary_language",
  industry: "industry",
  valueProposition: "value_proposition",
  targetCustomers: "target_customers",
  targetIndustries: "target_industries",
  targetCompanySizes: "target_company_sizes",
  targetRoles: "target_roles",
  geographies: "geographies",
  painPoints: "pain_points",
  salesAngles: "sales_angles",
};

// A human editing a field is neither a website fact nor a model inference —
// it gets its own provenance so the UI can say "you told us this" rather
// than implying Talvia verified it independently. Confidence 1 here means
// "we're certain the user declared this," not "we verified it's accurate."
export async function updateActiveBusinessContext(context: WorkspaceContext, input: BusinessContextEditInput): Promise<BusinessContextRecord | null> {
  const existing = await getActiveBusinessContext(context);
  if (!existing) return null;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const editedFields = new Set(existing.manuallyEditedFields);
  let index = 1;

  for (const field of PLAIN_FIELDS) {
    if (input[field] === undefined) continue;
    setClauses.push(`${COLUMN_BY_FIELD[field]}=$${index}`);
    values.push(Array.isArray(input[field]) ? JSON.stringify(input[field]) : input[field]);
    editedFields.add(field);
    index += 1;
  }
  for (const field of SCORED_STRING_FIELDS) {
    if (input[field] === undefined) continue;
    setClauses.push(`${COLUMN_BY_FIELD[field]}=$${index}`);
    values.push(JSON.stringify({ value: input[field], provenance: "user_provided", confidence: 1 }));
    editedFields.add(field);
    index += 1;
  }
  for (const field of SCORED_ARRAY_FIELDS) {
    if (input[field] === undefined) continue;
    setClauses.push(`${COLUMN_BY_FIELD[field]}=$${index}`);
    values.push(JSON.stringify({ value: input[field], provenance: "user_provided", confidence: 1 }));
    editedFields.add(field);
    index += 1;
  }

  if (setClauses.length === 0) return existing;

  setClauses.push(`manually_edited_fields=$${index}`);
  values.push(JSON.stringify(Array.from(editedFields)));
  index += 1;
  setClauses.push(`status='ready'`, `error_reason=null`, `updated_at=now()`);

  values.push(context.workspaceId, existing.id);
  const result = await database.query<Row>(
    `update business_contexts set ${setClauses.join(",")} where workspace_id=$${index} and id=$${index + 1} returning *`,
    values,
  );
  return result.rows[0] ? map(result.rows[0]) : null;
}

// A field the user corrected by hand must survive the next automatic
// analysis, even if the model re-detects the old value — reanalysis
// overwrites everything EXCEPT the fields already in manuallyEditedFields.
function preserveManualFields(existing: BusinessContextRecord | null, fresh: Partial<Row>): Partial<Row> {
  if (!existing || existing.manuallyEditedFields.length === 0) return fresh;
  const merged: Partial<Row> = { ...fresh };
  for (const field of existing.manuallyEditedFields) {
    const column = COLUMN_BY_FIELD[field];
    if (!column) continue;
    (merged as Record<string, unknown>)[column] = (existing as unknown as Record<string, unknown>)[field];
  }
  return merged;
}

export async function runBusinessContextAnalysis(context: WorkspaceContext, website: string): Promise<BusinessContextRecord> {
  await assertNotRateLimited(context);
  const existing = await getActiveBusinessContext(context);
  const startedAt = Date.now();
  const outcome = await analyzeBusinessFromWebsite(website);
  const durationMs = Date.now() - startedAt;

  if (outcome.status === "ready") {
    const saved = await replaceActiveContext(context, {
      status: "ready",
      website,
      ...preserveManualFields(existing, toRowFields(outcome.result)),
      source: "website_analysis",
      analysis_version: ANALYSIS_VERSION,
      source_pages: outcome.sourcePages,
      manually_edited_fields: existing?.manuallyEditedFields ?? [],
      ai_model: outcome.model,
    });
    await logRun(context, saved.id, website, "succeeded", {
      pagesFetched: outcome.pagesFetched,
      contentChars: outcome.contentChars,
      durationMs,
      aiModel: outcome.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    });
    return saved;
  }

  const status: BusinessContextStatus = outcome.status === "insufficient_content" ? "insufficient_content" : "error";
  const saved = await replaceActiveContext(context, {
    status,
    website,
    error_reason: outcome.reason,
    source: "website_analysis",
    analysis_version: ANALYSIS_VERSION,
  });
  await logRun(context, saved.id, website, outcome.status === "insufficient_content" ? "insufficient_content" : "failed", {
    pagesFetched: outcome.pagesFetched,
    contentChars: outcome.contentChars,
    durationMs,
    errorReason: outcome.reason,
  });
  return saved;
}

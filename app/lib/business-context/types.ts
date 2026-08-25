import type { JSONSchema } from "../ai/provider";

// Provenance keeps a hard line between what the site actually says (fact),
// what Talvia concluded from it (inference), what Talvia recommends
// (suggestion), and what a human declared or corrected (user_provided) —
// never collapse a guess, or a user's word, into a verified certainty.
// AI generation only ever produces fact/inference/suggestion; user_provided
// is assigned exclusively by the service layer when a human edits a field.
export type Provenance = "fact" | "inference" | "suggestion" | "user_provided";

export type ScoredField<T> = {
  value: T;
  provenance: Provenance;
  confidence: number; // 0..1
};

export type CustomerType = "b2b" | "b2c" | "both";
const CUSTOMER_TYPES: CustomerType[] = ["b2b", "b2c", "both"];

export type BusinessAnalysisResult = {
  companyName: string;
  businessDescription: string;
  services: string[];
  products: string[];
  keywords: string[];
  language: string;
  industry: ScoredField<string>;
  valueProposition: ScoredField<string>;
  customerType: ScoredField<CustomerType>;
  targetCustomers: ScoredField<string[]>;
  targetIndustries: ScoredField<string[]>;
  targetCompanySizes: ScoredField<string[]>;
  targetRoles: ScoredField<string[]>;
  geographies: ScoredField<string[]>;
  painPoints: ScoredField<string[]>;
  salesAngles: ScoredField<string[]>;
  insufficientContent: boolean;
};

function scoredFieldSchema(valueSchema: JSONSchema, provenanceOptions: Provenance[]): JSONSchema {
  return {
    type: "object",
    properties: {
      value: valueSchema,
      provenance: { type: "string", enum: provenanceOptions },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["value", "provenance", "confidence"],
    additionalProperties: false,
  };
}

const stringArray: JSONSchema = { type: "array", items: { type: "string" }, maxItems: 12 };

// Passed to the AIProvider — the model must return exactly this shape.
// Re-validated at runtime by validateBusinessAnalysisResult() before this
// ever reaches persistence; the schema alone is not trusted.
export const businessAnalysisSchema: JSONSchema = {
  type: "object",
  properties: {
    companyName: { type: "string" },
    businessDescription: { type: "string" },
    services: stringArray,
    products: stringArray,
    keywords: stringArray,
    language: { type: "string", description: "ISO 639-1 code, e.g. 'fr' or 'en'" },
    industry: scoredFieldSchema({ type: "string" }, ["fact", "inference"]),
    valueProposition: scoredFieldSchema({ type: "string" }, ["fact", "inference"]),
    customerType: scoredFieldSchema({ type: "string", enum: CUSTOMER_TYPES }, ["inference"]),
    targetCustomers: scoredFieldSchema(stringArray, ["fact", "inference"]),
    targetIndustries: scoredFieldSchema(stringArray, ["fact", "inference"]),
    targetCompanySizes: scoredFieldSchema(stringArray, ["inference"]),
    targetRoles: scoredFieldSchema(stringArray, ["fact", "inference"]),
    geographies: scoredFieldSchema(stringArray, ["fact", "inference"]),
    painPoints: scoredFieldSchema(stringArray, ["inference", "suggestion"]),
    salesAngles: scoredFieldSchema(stringArray, ["suggestion"]),
    insufficientContent: { type: "boolean" },
  },
  required: [
    "companyName", "businessDescription", "services", "products", "keywords", "language",
    "industry", "valueProposition", "customerType", "targetCustomers", "targetIndustries", "targetCompanySizes",
    "targetRoles", "geographies", "painPoints", "salesAngles", "insufficientContent",
  ],
  additionalProperties: false,
};

function isScoredField(value: unknown): value is ScoredField<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    "value" in record &&
    typeof record.provenance === "string" &&
    ["fact", "inference", "suggestion"].includes(record.provenance) &&
    typeof record.confidence === "number" &&
    record.confidence >= 0 &&
    record.confidence <= 1
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Independent runtime check of the parsed model output. Deliberately does
// not trust jsonSchemaOutputFormat/parse() alone — a corrupted or
// malicious response must never reach the database.
export function validateBusinessAnalysisResult(candidate: unknown): BusinessAnalysisResult | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const c = candidate as Record<string, unknown>;

  if (typeof c.companyName !== "string") return null;
  if (typeof c.businessDescription !== "string") return null;
  if (!isStringArray(c.services) || !isStringArray(c.products) || !isStringArray(c.keywords)) return null;
  if (typeof c.language !== "string") return null;
  if (typeof c.insufficientContent !== "boolean") return null;

  const scoredStringFields = ["industry", "valueProposition"] as const;
  for (const key of scoredStringFields) {
    const field = c[key];
    if (!isScoredField(field) || typeof field.value !== "string") return null;
  }

  const customerTypeField = c.customerType;
  if (!isScoredField(customerTypeField) || !CUSTOMER_TYPES.includes(customerTypeField.value as CustomerType)) return null;

  const scoredArrayFields = [
    "targetCustomers", "targetIndustries", "targetCompanySizes",
    "targetRoles", "geographies", "painPoints", "salesAngles",
  ] as const;
  for (const key of scoredArrayFields) {
    const field = c[key];
    if (!isScoredField(field) || !isStringArray(field.value)) return null;
  }

  return c as unknown as BusinessAnalysisResult;
}

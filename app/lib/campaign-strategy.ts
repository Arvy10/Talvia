import { getAIProvider } from "./ai";
import type { BusinessContextRecord } from "./business-context/business-context-service";

// "Business Context" answers "who is my company"; "Campaign Strategy"
// answers "for THIS campaign, who should I contact and why" — a distinct,
// persisted object per campaign (see docs/product/PRINCIPLES.md §5: human
// edits take priority over re-analysis, the exact same rule
// business-context-service.ts already enforces via manuallyEditedFields,
// replicated here rather than reinvented).

export type CampaignStrategy = {
  objective: string;
  targetDescription: string;
  targetRoles: string[];
  companyTypes: string[];
  industries: string[];
  // Qualification-only, deliberately (docs spec Phase 2B §6): our Unipile
  // wrapper (UnipileSearchCriteria in app/lib/providers/unipile.ts) exposes
  // no location parameter, so geography never reaches the LinkedIn search
  // request itself — only deterministicSignals() in prospecting.ts compares
  // it against a candidate's own location, after results come back.
  geography: string[];
  qualificationCriteria: string[];
  exclusionCriteria: string[];
  reasoning: string;
  source: "ai_generated" | "user_edited";
  manuallyEditedFields: string[];
  generatedAt: string;
  aiModel: string | null;
  // null = not yet validated. Set only by validateCampaignStrategy(), on an
  // explicit user action — never by generation or by an edit. Any edit
  // (applyStrategyEdit) or regeneration (generateCampaignStrategy /
  // preserveManualStrategyFields) resets this to null: a strategy the user
  // already approved once must be re-approved after it changes.
  validatedAt: string | null;
};

const EDITABLE_FIELDS = ["objective", "targetDescription", "targetRoles", "companyTypes", "industries", "geography", "qualificationCriteria", "exclusionCriteria", "reasoning"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
export type CampaignStrategyEditInput = Partial<Pick<CampaignStrategy, EditableField>>;

export class InsufficientBusinessContextError extends Error {}

function hasEnoughBusinessContext(businessContext: BusinessContextRecord | null): businessContext is BusinessContextRecord {
  if (!businessContext) return false;
  const hasIdentity = Boolean(businessContext.companyName || businessContext.businessDescription);
  const hasTargetSignal = Boolean(
    businessContext.targetRoles?.value?.length ||
    businessContext.targetIndustries?.value?.length ||
    businessContext.targetCustomers?.value?.length,
  );
  return hasIdentity && hasTargetSignal;
}

function deterministicStrategy(businessContext: BusinessContextRecord): CampaignStrategy {
  return {
    objective: businessContext.companyName ? `Trouver des prospects LinkedIn pertinents pour ${businessContext.companyName}.` : "Trouver des prospects LinkedIn pertinents.",
    targetDescription: businessContext.businessDescription ?? "",
    targetRoles: businessContext.targetRoles?.value ?? [],
    companyTypes: businessContext.targetCustomers?.value ?? [],
    industries: businessContext.targetIndustries?.value ?? [],
    geography: businessContext.geographies?.value ?? [],
    qualificationCriteria: [],
    exclusionCriteria: [],
    reasoning: "Stratégie déduite directement des champs de votre Business Context (aucun fournisseur IA configuré sur cet environnement).",
    source: "ai_generated",
    manuallyEditedFields: [],
    generatedAt: new Date().toISOString(),
    aiModel: null,
    validatedAt: null,
  };
}

function buildStrategyPrompt(businessContext: BusinessContextRecord): string {
  const lines = [
    businessContext.companyName ? `Entreprise : ${businessContext.companyName}` : null,
    businessContext.businessDescription ? `Activité : ${businessContext.businessDescription}` : null,
    businessContext.industry?.value ? `Secteur : ${businessContext.industry.value}` : null,
    businessContext.valueProposition?.value ? `Proposition de valeur : ${businessContext.valueProposition.value}` : null,
    businessContext.targetCustomers?.value?.length ? `Clients cibles déjà connus : ${businessContext.targetCustomers.value.join(", ")}` : null,
    businessContext.targetIndustries?.value?.length ? `Secteurs cibles déjà connus : ${businessContext.targetIndustries.value.join(", ")}` : null,
    businessContext.targetRoles?.value?.length ? `Rôles cibles déjà connus : ${businessContext.targetRoles.value.join(", ")}` : null,
    businessContext.targetCompanySizes?.value?.length ? `Tailles d'entreprise ciblées : ${businessContext.targetCompanySizes.value.join(", ")}` : null,
    businessContext.geographies?.value?.length ? `Géographies déjà connues : ${businessContext.geographies.value.join(", ")}` : null,
    businessContext.painPoints?.value?.length ? `Problèmes résolus : ${businessContext.painPoints.value.join(", ")}` : null,
  ].filter(Boolean);
  return `Voici ce que nous savons de l'entreprise :\n${lines.join("\n")}\n\nPropose une stratégie de prospection LinkedIn pour une nouvelle campagne : objectif, description de la cible, rôles à rechercher, types d'entreprises, secteurs, géographie, critères de qualification, critères d'exclusion, et le raisonnement qui justifie ce ciblage — fondés UNIQUEMENT sur ce qui précède. Laisse un champ vide plutôt que d'inventer une information qui n'est pas déjà donnée ci-dessus.`;
}

const CAMPAIGN_STRATEGY_SCHEMA = {
  type: "object",
  properties: {
    objective: { type: "string" },
    targetDescription: { type: "string" },
    targetRoles: { type: "array", items: { type: "string" } },
    companyTypes: { type: "array", items: { type: "string" } },
    industries: { type: "array", items: { type: "string" } },
    geography: { type: "array", items: { type: "string" } },
    qualificationCriteria: { type: "array", items: { type: "string" } },
    exclusionCriteria: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: ["objective", "targetDescription", "targetRoles", "companyTypes", "industries", "geography", "qualificationCriteria", "exclusionCriteria", "reasoning"],
  additionalProperties: false,
};

// Provider-agnostic on purpose (docs spec §5): this is the only function in
// Campaigns that knows an AI call is involved. Swapping the underlying
// model/vendor is entirely getAIProvider()'s concern, never this file's.
export async function generateCampaignStrategy(businessContext: BusinessContextRecord | null): Promise<CampaignStrategy> {
  if (!hasEnoughBusinessContext(businessContext)) {
    throw new InsufficientBusinessContextError("Le Business Context ne contient pas encore assez d'informations de cible (rôles, secteurs ou types de clients) pour proposer une stratégie fiable. Complétez-le dans Paramètres avant de générer une stratégie de campagne.");
  }

  const provider = getAIProvider();
  if (!provider) return deterministicStrategy(businessContext);

  try {
    const result = await provider.generateStructured<Omit<CampaignStrategy, "source" | "manuallyEditedFields" | "generatedAt" | "aiModel">>({
      system: "Tu es un stratège de prospection B2B. À partir du profil d'entreprise fourni, propose une cible de prospection LinkedIn fondée UNIQUEMENT sur les informations données. N'invente aucune information (secteur, rôle, taille d'entreprise, géographie) absente du profil fourni — laisse le champ correspondant vide plutôt que de l'inventer. Réponds en français.",
      prompt: buildStrategyPrompt(businessContext),
      schemaName: "CampaignStrategy",
      schema: CAMPAIGN_STRATEGY_SCHEMA,
      maxTokens: 800,
    });
    return { ...result.data, source: "ai_generated", manuallyEditedFields: [], generatedAt: new Date().toISOString(), aiModel: result.model, validatedAt: null };
  } catch {
    // A provider hiccup must never block strategy generation entirely — same
    // philosophy as buildInviteNote's fallback in prospecting.ts.
    return deterministicStrategy(businessContext);
  }
}

// A human correcting even one field must never be silently regenerated over
// (docs/product/PRINCIPLES.md §5) — mirrors business-context-service.ts's
// updateActiveBusinessContext exactly: mark edited fields, flip source.
// Phase 2B §2: any edit — even to an already-validated strategy — resets
// validatedAt to null. searchProspects() enforces this server-side; the
// caller (the strategy PATCH route) must never re-set validatedAt itself.
export function applyStrategyEdit(existing: CampaignStrategy, edits: CampaignStrategyEditInput): CampaignStrategy {
  const manuallyEditedFields = new Set(existing.manuallyEditedFields);
  const next: CampaignStrategy = { ...existing };
  for (const field of EDITABLE_FIELDS) {
    if (edits[field] === undefined) continue;
    (next as unknown as Record<string, unknown>)[field] = edits[field];
    manuallyEditedFields.add(field);
  }
  next.manuallyEditedFields = Array.from(manuallyEditedFields);
  next.source = "user_edited";
  next.validatedAt = null;
  return next;
}

// Regenerating a strategy (e.g. after the Business Context itself changes)
// must not wipe out fields the user already corrected — same
// preserveManualFields pattern business-context-service.ts uses for
// re-analysis. A regenerated strategy is always unvalidated (Phase 2B §1),
// regardless of what the previous one was — `fresh` already carries
// validatedAt: null from generateCampaignStrategy, but it's set explicitly
// here too so the invariant never silently depends on the caller.
export function preserveManualStrategyFields(existing: CampaignStrategy | null, fresh: CampaignStrategy): CampaignStrategy {
  if (!existing || existing.manuallyEditedFields.length === 0) return { ...fresh, validatedAt: null };
  const merged: CampaignStrategy = { ...fresh, manuallyEditedFields: existing.manuallyEditedFields, source: "user_edited", validatedAt: null };
  for (const field of existing.manuallyEditedFields) {
    (merged as unknown as Record<string, unknown>)[field] = (existing as unknown as Record<string, unknown>)[field];
  }
  return merged;
}

// The one explicit user action that makes a strategy usable by
// searchProspects() (Phase 2B §1). Never called implicitly by generation or
// editing.
export function validateCampaignStrategy(existing: CampaignStrategy): CampaignStrategy {
  return { ...existing, validatedAt: new Date().toISOString() };
}

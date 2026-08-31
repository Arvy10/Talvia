import { database } from "./database";
import { getAIProvider } from "./ai";
import { getCampaignStrategy } from "./campaigns";
import type { CampaignStrategy } from "./campaign-strategy";
import { getActiveBusinessContext, type BusinessContextRecord } from "./business-context/business-context-service";
import type { CandidateQualification } from "./prospecting";
import type { ReasonCode } from "./campaign-execution/reason-codes";
import type { WorkspaceContext } from "./workspace-context";

// Phase 3: Qualified Candidate -> Evidence -> Outreach Angle -> Generated
// text -> Human review -> Approved text -> Executor sends EXACTLY that.
// Phase 3B: the three epistemic levels inside "evidence" are kept
// structurally separate (docs spec §1/§2/§3) — observedFacts (things really
// seen on THIS prospect), qualificationContext (Talvia's own analysis of
// them), and strategyContext (what the campaign is looking for in general)
// are never merged into one undifferentiated list, because a Phase 3 audit
// found that merging them let interpretation and campaign-level assumptions
// read as "known facts about this person" to the generator.

export type ObservedFact = { type: string; value: string; source: string };

export type QualificationContext = {
  score: number;
  fit: CandidateQualification["fit"];
  reasons: string[];
  uncertainties: string[];
  disqualified: boolean;
  disqualificationReasons: string[];
} | null;

export type StrategyContext = {
  targetRoles: string[];
  companyTypes: string[];
  industries: string[];
  geography: string[];
  qualificationCriteria: string[];
  exclusionCriteria: string[];
} | null;

export type PersonalizationEvidence = {
  observedFacts: ObservedFact[];
  qualificationContext: QualificationContext;
  strategyContext: StrategyContext;
  uncertainties: string[];
};

export type OutreachAngle = {
  whyContactThisPerson: string;
  relevantOffer: string;
  evidenceUsed: string[];
  conversationGoal: string;
  tone: string;
};

// not_generated -> generated -> edited -> approved. Only `approvedText` is
// ever sent by the executor (docs spec §10/§12) — generatedText/editedText
// exist purely for the human review screen.
export type GeneratedText = {
  status: "not_generated" | "generated" | "edited" | "approved";
  generatedText: string | null;
  editedText: string | null;
  approvedText: string | null;
  approvedAt: string | null;
};

// One entry per message-type campaign_steps row — an array, not a single
// object, so a future follow-up step needs no further migration (docs spec
// §14).
export type MessageArtifact = GeneratedText & { stepId: string };

export type ParticipantPersonalization = {
  evidence: PersonalizationEvidence;
  outreachAngle: OutreachAngle | null;
  invitation: GeneratedText;
  messages: MessageArtifact[];
  generatedAt: string | null;
  aiModel: string | null;
};

const EMPTY_TEXT: GeneratedText = { status: "not_generated", generatedText: null, editedText: null, approvedText: null, approvedAt: null };
const EMPTY_EVIDENCE: PersonalizationEvidence = { observedFacts: [], qualificationContext: null, strategyContext: null, uncertainties: [] };

export function emptyPersonalization(): ParticipantPersonalization {
  return { evidence: { ...EMPTY_EVIDENCE }, outreachAngle: null, invitation: { ...EMPTY_TEXT }, messages: [], generatedAt: null, aiModel: null };
}

// Phase 3B §11: a personalization row written before this change has
// evidence.facts (a flat array), not evidence.observedFacts — reading it as
// the new shape would silently treat old, unseparated data as trustworthy.
// Safe-fail instead: an old-shape evidence object is discarded (never
// reused as grounding), while invitation/messages — plain approved-text
// records, unaffected by this shape change — are preserved as-is, so an
// already-approved, already-sent-eligible text never breaks.
function isNewEvidenceShape(evidence: unknown): evidence is PersonalizationEvidence {
  return Boolean(evidence && typeof evidence === "object" && "observedFacts" in evidence);
}
function normalizePersonalization(raw: unknown): ParticipantPersonalization {
  if (!raw || typeof raw !== "object") return emptyPersonalization();
  const value = raw as Partial<ParticipantPersonalization> & { evidence?: unknown };
  return {
    evidence: isNewEvidenceShape(value.evidence) ? value.evidence : { ...EMPTY_EVIDENCE },
    outreachAngle: value.outreachAngle ?? null,
    invitation: value.invitation ?? { ...EMPTY_TEXT },
    messages: value.messages ?? [],
    generatedAt: value.generatedAt ?? null,
    aiModel: value.aiModel ?? null,
  };
}

type CandidateFacts = { name: string; headline?: string | null; role?: string | null; company?: string | null; location?: string | null; profileUrl?: string | null; qualification?: CandidateQualification | null };

// Pure, deterministic, no AI call. observedFacts contains ONLY things
// actually seen on THIS candidate (docs spec §1) — qualification and
// strategy data are real, but they are not observations about this person,
// so they live in their own, separately-labeled context objects instead.
export function buildPersonalizationEvidence(candidate: CandidateFacts, strategy: CampaignStrategy | null): PersonalizationEvidence {
  const observedFacts: ObservedFact[] = [{ type: "name", value: candidate.name, source: "linkedin_search" }];
  const uncertainties: string[] = [];

  if (candidate.headline) observedFacts.push({ type: "headline", value: candidate.headline, source: "linkedin_search" });
  if (candidate.role) observedFacts.push({ type: "role", value: candidate.role, source: "linkedin_search" });
  if (candidate.company) observedFacts.push({ type: "company", value: candidate.company, source: "linkedin_search" });
  if (candidate.location) observedFacts.push({ type: "location", value: candidate.location, source: "linkedin_search" });
  if (candidate.profileUrl) observedFacts.push({ type: "profile_url", value: candidate.profileUrl, source: "linkedin_search" });

  if (!candidate.headline && !candidate.role) uncertainties.push("Rôle/fonction non connu — ne pas affirmer de fonction précise.");
  if (!candidate.company) uncertainties.push("Entreprise non connue — ne pas nommer d'entreprise.");
  if (!candidate.location) uncertainties.push("Localisation non connue.");
  for (const note of candidate.qualification?.uncertainties ?? []) uncertainties.push(note);

  const qualificationContext: QualificationContext = candidate.qualification ? {
    score: candidate.qualification.score,
    fit: candidate.qualification.fit,
    reasons: candidate.qualification.reasons,
    uncertainties: candidate.qualification.uncertainties,
    disqualified: candidate.qualification.disqualified,
    disqualificationReasons: candidate.qualification.disqualificationReasons,
  } : null;

  const strategyContext: StrategyContext = strategy ? {
    targetRoles: strategy.targetRoles,
    companyTypes: strategy.companyTypes,
    industries: strategy.industries,
    geography: strategy.geography,
    qualificationCriteria: strategy.qualificationCriteria,
    exclusionCriteria: strategy.exclusionCriteria,
  } : null;

  return { observedFacts, qualificationContext, strategyContext, uncertainties };
}

// Secondary, narrow safety net (docs spec §5) — NOT the primary defense
// anymore. Catches a handful of named categories Talvia never actually
// collects data for, regardless of how the text is phrased. The primary
// defense is structural: isGroundedText() below, checked first.
const UNSUPPORTED_CLAIM_PATTERNS: Array<{ pattern: RegExp; requiresFactType: string }> = [
  { pattern: /post|publication récente|article que vous avez partagé/i, requiresFactType: "recent_post" },
  { pattern: /lev[ée]e de fonds|financement récent/i, requiresFactType: "funding_signal" },
  { pattern: /vous recrutez|en pleine embauche|recrutement actif/i, requiresFactType: "hiring_signal" },
  { pattern: /votre site( web)? (semble|ne refl[èe]te|est dat[ée]|m[ée]riterait)/i, requiresFactType: "website_review" },
  { pattern: /croissance rapide|en pleine croissance|d[ée]veloppe rapidement/i, requiresFactType: "growth_signal" },
  { pattern: /chiffre d'affaires|votre ca\b/i, requiresFactType: "revenue_signal" },
  { pattern: /technologie que vous utilisez|votre stack technique/i, requiresFactType: "tech_signal" },
];

function containsUnsupportedClaim(text: string): boolean {
  return UNSUPPORTED_CLAIM_PATTERNS.some(({ pattern }) => pattern.test(text));
}

// The PRIMARY grounding check (docs spec §6/§7). Two rules, both cheap and
// structural — no second AI call, no giant regex list:
//   1. Every fact type the model claims to have used must genuinely be in
//      observedFacts — a citation of a type that doesn't exist (e.g. the
//      model naming "growth_signal" when nothing like that was ever
//      collected) is an immediate red flag.
//   2. An assertive sentence (doesn't end in "?") that cites NO fact at all
//      is exactly the "vous devez sûrement..." pattern the Phase 3 audit
//      found slipping through — a genuine open question is fine even with
//      light grounding, since it invites the prospect to confirm, it
//      doesn't assert something as already true.
// This does NOT verify the citation is semantically honest (the model
// could cite a real type without the sentence truly needing it) — that
// residual trust gap is disclosed, not hidden; see the Phase 3B report.
function isGroundedText(text: string, usedFactTypes: string[], observedFactTypes: Set<string>): boolean {
  if (!usedFactTypes.every((type) => observedFactTypes.has(type))) return false;
  const isQuestion = text.trim().endsWith("?");
  if (usedFactTypes.length === 0 && !isQuestion) return false;
  return true;
}

// Uses ONLY observedFacts + Business Context (docs spec §9) — never
// qualification.reasons turned into a sentence, never a strategy company
// type asserted as this prospect's own attribute. `targetType` below
// describes what TALVIA works with (legitimate business-context-shaped
// information), phrased as a question about relevance — never as "Acme is
// an agency".
function deterministicFallback(candidate: CandidateFacts, businessContext: BusinessContextRecord | null, strategy: CampaignStrategy | null, evidence: PersonalizationEvidence): { outreachAngle: OutreachAngle; invitationNote: string; message: string } {
  const firstName = candidate.name.split(/\s+/)[0] || candidate.name;
  const hasRole = evidence.observedFacts.some((fact) => fact.type === "role" || fact.type === "headline");
  const hasCompany = evidence.observedFacts.some((fact) => fact.type === "company");
  const targetType = strategy?.companyTypes[0];

  const outreachAngle: OutreachAngle = {
    whyContactThisPerson: hasRole ? "Le profil correspond au rôle ciblé par la campagne." : "Le profil correspond au type de cible de la campagne.",
    relevantOffer: businessContext?.businessDescription ?? "",
    evidenceUsed: evidence.observedFacts.map((fact) => fact.type),
    conversationGoal: "Ouvrir une conversation sur un besoin potentiel lié à l'offre.",
    tone: "professionnel, direct, sans pression",
  };

  const invitationNote = (businessContext?.companyName
    ? `Bonjour ${firstName}, je travaille chez ${businessContext.companyName}${hasCompany ? ` et votre profil chez ${candidate.company} m'intéresse` : " et votre profil m'intéresse"}. Ravi d'échanger !`
    : `Bonjour ${firstName}, votre profil m'intéresse, ravi d'échanger avec vous !`
  ).slice(0, 300);

  const message = [
    `Bonjour ${firstName}, merci d'avoir accepté mon invitation !`,
    targetType ? `Je travaille notamment avec des profils comme ${targetType.toLowerCase()}` : businessContext?.businessDescription ? `Je travaille sur ${businessContext.businessDescription}` : null,
    hasCompany ? `est-ce un sujet pertinent chez ${candidate.company} ?` : "est-ce un sujet qui pourrait vous intéresser ?",
  ].filter(Boolean).join(" ");

  return { outreachAngle, invitationNote, message };
}

// A follow-up is a message step like any other (docs spec §9) — the
// executor already sends whatever `approvedText` is keyed to its stepId, so
// nothing changes there. What a follow-up needs beyond the first message is
// continuity (docs spec §12): it must read as "coming back to" the prior
// message, never as a fresh introduction. `previousText` is the best text
// known so far for the immediately preceding message-type step — approved
// if approved, otherwise the last proposal — never fabricated content.
function deterministicFollowUp(candidate: CandidateFacts): string {
  const firstName = candidate.name.split(/\s+/)[0] || candidate.name;
  return `Bonjour ${firstName}, je me permets de revenir vers vous au cas où mon précédent message se serait perdu. Est-ce que le sujet vous intéresse toujours ?`;
}

function buildFollowUpPrompt(businessContext: BusinessContextRecord | null, evidence: PersonalizationEvidence, outreachAngle: OutreachAngle, previousText: string, guidance?: string): string {
  const observed = evidence.observedFacts.map((fact) => `- ${fact.type}: ${fact.value}`).join("\n") || "(aucun fait observé)";
  const uncertainties = evidence.uncertainties.length ? evidence.uncertainties.map((note) => `- ${note}`).join("\n") : "(aucune)";

  return [
    `=== OBSERVED FACTS ===\nFaits directement observés pour CE prospect précis. Tu peux les affirmer comme des faits.\n${observed}`,
    `=== UNCERTAINTIES / UNKNOWN ===\nCes éléments sont explicitement inconnus. Ne les transforme JAMAIS en affirmation.\n${uncertainties}`,
    `=== ANGLE DE CONVERSATION DÉJÀ DÉFINI ===\n${outreachAngle.whyContactThisPerson} Objectif : ${outreachAngle.conversationGoal}. Ton : ${outreachAngle.tone}.`,
    `=== MESSAGE PRÉCÉDENT DE CETTE SÉQUENCE (CONTEXTE CONVERSATIONNEL UNIQUEMENT — jamais une preuve sur le prospect) ===\nCe message a été envoyé (ou est sur le point de l'être). Tu peux t'y référer pour la continuité de la conversation ("je reviens vers vous", "suite à mon message"). Mais son CONTENU — y compris toute question qu'il pose — ne prouve RIEN sur le prospect. Si le message précédent demande "est-ce que X est un sujet chez vous ?", cela ne veut PAS dire que X est effectivement un sujet chez ce prospect : personne n'y a encore répondu.\n${previousText}`,
    `=== BUSINESS CONTEXT (décrit l'expéditeur, pas le prospect) ===\n${businessContext?.companyName ?? "inconnue"}${businessContext?.businessDescription ? ` — ${businessContext.businessDescription}` : ""}`,
    guidance ? `Consigne du fondateur pour cette relance : ${guidance}` : null,
    `INSTRUCTIONS :\nRédige une RELANCE (follow-up) courte qui fait explicitement suite au MESSAGE PRÉCÉDENT ci-dessus — jamais une nouvelle prise de contact qui recommence à zéro (interdit : "Bonjour, je suis..." comme si la conversation n'avait pas commencé).\n\nTu dois déclarer séparément deux choses :\n1) \`factualClaims\` : toute affirmation NOUVELLE que le texte fait sur le prospect (autre qu'une simple question ou une référence à la conversation). Chaque affirmation doit être courte (quelques mots, pas une phrase développée) et citer les \`supportedByFactTypes\` (parmi OBSERVED FACTS) qui la justifient EXACTEMENT — pas un fait vaguement lié. Exemple valide : {claim: "travaille chez Acme", supportedByFactTypes: ["company"]}. Exemple INVALIDE (n'écris jamais ça) : {claim: "l'acquisition est un enjeu important pour Acme", supportedByFactTypes: ["company"]} — connaître le nom de l'entreprise ne prouve rien sur ses enjeux internes.\n2) \`conversationalReferences\` : les questions ouvertes et références conversationnelles du texte (ex. "revenir vers vous suite à mon message précédent", "est-ce que le sujet vous intéresse toujours ?") — celles-ci n'affirment rien de nouveau sur le prospect, donc n'ont pas besoin de factualClaims.\n\nSi le texte entier n'est qu'une question ouverte ou une relance conversationnelle sans nouvelle affirmation, \`factualClaims\` doit être un tableau vide — c'est le cas normal et souhaité, pas une erreur. Pas de formule générique, pas de jargon IA. Réponds en français.`,
  ].filter(Boolean).join("\n\n");
}

type FollowUpFactualClaim = { claim: string; supportedByFactTypes: string[] };

// A factual claim is never trusted just because it cites a real fact type
// (docs Phase 4B §3/§4 — the exact gap the Phase 4 audit demonstrated:
// citing "company" was enough to smuggle "l'acquisition est un enjeu
// important pour Acme" past a pure citation check, even though knowing the
// company's name proves nothing about its internal priorities). Two cheap,
// structural checks close it without a second AI call and without a large
// regex list: (a) the claim must actually mention the cited fact's own
// value — a citation that isn't load-bearing in the sentence is decorative,
// not support; (b) the claim must be short — a genuine attribute restatement
// ("travaille chez Acme") is a few words; an inference dressed up as a fact
// ("l'acquisition est un enjeu important pour Acme") reliably is not.
const MAX_FACTUAL_CLAIM_WORDS = 6;

function isSupportedFactualClaim(claim: FollowUpFactualClaim, observedFactTypes: Set<string>, observedFactValues: Map<string, string>): boolean {
  if (claim.supportedByFactTypes.length === 0) return false; // an admitted-unsupported claim
  if (!claim.supportedByFactTypes.every((type) => observedFactTypes.has(type))) return false; // citing a type that was never observed
  const wordCount = claim.claim.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_FACTUAL_CLAIM_WORDS) return false;
  return claim.supportedByFactTypes.some((type) => {
    const value = observedFactValues.get(type);
    return Boolean(value) && claim.claim.toLowerCase().includes(value!.toLowerCase());
  });
}

// A generic backstop specific to follow-ups: an assertive (non-question)
// sentence naming a need/priority/challenge is never something Talvia has
// actually observed — observedFacts are pure attributes (name/role/company/
// location...), never situational judgments — so this narrow category is
// rejected outright, independent of whether the model declared it as a
// factualClaim at all (the model choosing not to self-report a claim must
// not be a way around the check).
const NEED_OR_PROBLEM_ASSERTION = /\b(enjeu|probl[èe]me|priorit[ée]s?|besoins?|d[ée]fis?|pr[ée]occupations?|difficult[ée]s?)\b/i;

function isGroundedFollowUp(text: string, factualClaims: FollowUpFactualClaim[], observedFactTypes: Set<string>, observedFactValues: Map<string, string>): boolean {
  if (containsUnsupportedClaim(text)) return false;
  if (!text.trim().endsWith("?") && NEED_OR_PROBLEM_ASSERTION.test(text)) return false;
  return factualClaims.every((claim) => isSupportedFactualClaim(claim, observedFactTypes, observedFactValues));
}

const FOLLOWUP_ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    factualClaims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          supportedByFactTypes: { type: "array", items: { type: "string" } },
        },
        required: ["claim", "supportedByFactTypes"],
        additionalProperties: false,
      },
    },
    // Purely descriptive — never validated as evidence. Declaring something
    // here is not a license to assert it as fact; see isGroundedFollowUp.
    conversationalReferences: { type: "array", items: { type: "string" } },
  },
  required: ["text", "factualClaims", "conversationalReferences"],
  additionalProperties: false,
};

async function generateFollowUpArtifact(
  businessContext: BusinessContextRecord | null,
  candidate: CandidateFacts,
  evidence: PersonalizationEvidence,
  outreachAngle: OutreachAngle,
  previousText: string,
  guidance?: string,
): Promise<{ text: string; aiModel: string | null }> {
  const provider = getAIProvider();
  if (!provider) return { text: deterministicFollowUp(candidate), aiModel: null };

  try {
    const result = await provider.generateStructured<{ text: string; factualClaims: FollowUpFactualClaim[]; conversationalReferences: string[] }>({
      system: "Tu écris une relance LinkedIn humaine, courte, qui fait explicitement suite au message précédent fourni. Le message précédent est un contexte conversationnel, jamais une preuve sur le prospect — en particulier, une question posée dans le message précédent ne prouve pas sa réponse. Toute nouvelle affirmation factuelle doit être déclarée séparément et strictement justifiée par les OBSERVED FACTS cités. Réponds en français.",
      prompt: buildFollowUpPrompt(businessContext, evidence, outreachAngle, previousText, guidance),
      schemaName: "PersonalizationFollowUp",
      schema: FOLLOWUP_ARTIFACT_SCHEMA,
      maxTokens: 500,
    });
    const observedTypes = new Set(evidence.observedFacts.map((fact) => fact.type));
    const observedValues = new Map(evidence.observedFacts.map((fact) => [fact.type, fact.value]));
    const grounded = isGroundedFollowUp(result.data.text, result.data.factualClaims, observedTypes, observedValues);
    return grounded ? { text: result.data.text, aiModel: result.model } : { text: deterministicFollowUp(candidate), aiModel: null };
  } catch {
    return { text: deterministicFollowUp(candidate), aiModel: null };
  }
}

const GENERATED_ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    // The model's own account of which observed-fact types it actually
    // relied on — validated server-side by isGroundedText(), never trusted
    // blindly (docs spec §6).
    usedFactTypes: { type: "array", items: { type: "string" } },
  },
  required: ["text", "usedFactTypes"],
  additionalProperties: false,
};

const GENERATION_SCHEMA = {
  type: "object",
  properties: {
    outreachAngle: {
      type: "object",
      properties: {
        whyContactThisPerson: { type: "string" },
        relevantOffer: { type: "string" },
        evidenceUsed: { type: "array", items: { type: "string" } },
        conversationGoal: { type: "string" },
        tone: { type: "string" },
      },
      required: ["whyContactThisPerson", "relevantOffer", "evidenceUsed", "conversationGoal", "tone"],
      additionalProperties: false,
    },
    invitation: GENERATED_ARTIFACT_SCHEMA,
    message: GENERATED_ARTIFACT_SCHEMA,
  },
  required: ["outreachAngle", "invitation", "message"],
  additionalProperties: false,
};

// The five explicitly-labeled sections (docs spec §4) — each carries its
// own epistemic instruction, so the separation lives in what the model
// actually reads, not only in our internal types.
function buildGenerationPrompt(businessContext: BusinessContextRecord | null, strategy: CampaignStrategy | null, evidence: PersonalizationEvidence, guidance?: string): string {
  const observed = evidence.observedFacts.map((fact) => `- ${fact.type}: ${fact.value}`).join("\n") || "(aucun fait observé)";
  const qualification = evidence.qualificationContext
    ? `Score: ${evidence.qualificationContext.score}/100, fit: ${evidence.qualificationContext.fit}.\nRaisons internes: ${evidence.qualificationContext.reasons.join("; ") || "aucune"}.\nIncertitudes internes: ${evidence.qualificationContext.uncertainties.join("; ") || "aucune"}.`
    : "(aucune qualification disponible)";
  const strategyBlock = evidence.strategyContext
    ? `Rôles recherchés par la campagne (en général) : ${evidence.strategyContext.targetRoles.join(", ") || "non précisé"}.\nTypes d'entreprises recherchés (en général) : ${evidence.strategyContext.companyTypes.join(", ") || "non précisé"}.\nSecteurs recherchés (en général) : ${evidence.strategyContext.industries.join(", ") || "non précisé"}.`
    : "(aucune stratégie disponible)";
  const uncertainties = evidence.uncertainties.length ? evidence.uncertainties.map((note) => `- ${note}`).join("\n") : "(aucune)";

  return [
    `=== OBSERVED FACTS ===\nFaits directement observés pour CE prospect précis. Tu peux les affirmer comme des faits.\n${observed}`,
    `=== QUALIFICATION CONTEXT (analyse interne Talvia — PAS des faits observés) ===\nÀ utiliser uniquement pour décider de la pertinence et de l'angle à adopter. Ne présente JAMAIS ces conclusions comme des faits observés sur la personne — ce sont des hypothèses de qualification, pas des observations.\n${qualification}`,
    `=== CAMPAIGN STRATEGY (décrit qui la campagne veut atteindre en général — PAS un fait sur ce prospect précis) ===\nCeci décrit la cible recherchée en général. Cela ne prouve RIEN sur les attributs individuels de cette personne — par exemple, si la stratégie cible des "agences" et que l'entreprise observée est "Acme", cela ne veut PAS dire qu'Acme est une agence.\n${strategyBlock}`,
    `=== UNCERTAINTIES / UNKNOWN ===\nCes éléments sont explicitement inconnus. Ne les transforme JAMAIS en affirmation.\n${uncertainties}`,
    `=== BUSINESS CONTEXT (décrit l'expéditeur, pas le prospect) ===\n${businessContext?.companyName ?? "inconnue"}${businessContext?.businessDescription ? ` — ${businessContext.businessDescription}` : ""}`,
    guidance ? `Consigne du fondateur pour le message : ${guidance}` : null,
    `INSTRUCTIONS :\nRédige, fondé UNIQUEMENT sur OBSERVED FACTS (et BUSINESS CONTEXT pour décrire ta propre offre) :\n1) un angle de conversation structuré — il peut s'appuyer sur QUALIFICATION CONTEXT et CAMPAIGN STRATEGY pour choisir la pertinence, mais l'angle reste un raisonnement interne, jamais une observation à énoncer telle quelle ;\n2) une note d'invitation LinkedIn courte (300 caractères maximum, faible pression, pas de pitch commercial) ;\n3) un premier message post-acceptation, court et conversationnel, avec une raison claire de parler.\n\nRÈGLE ABSOLUE : si une idée provient de QUALIFICATION CONTEXT ou CAMPAIGN STRATEGY plutôt que d'OBSERVED FACTS, formule-la comme une QUESTION OUVERTE, jamais comme une affirmation sur cette personne. Interdit : "Je vois que l'acquisition est un problème chez vous." Autorisé : "Est-ce que l'acquisition est un sujet que vous travaillez actuellement ?"\n\nPour l'invitation ET le message, indique aussi \`usedFactTypes\` : la liste des types d'OBSERVED FACTS que tu as réellement utilisés pour écrire ce texte précis. Laisse cette liste vide si le texte ne s'appuie sur aucun fait individuel précis (par exemple une question générique). N'invente rien de la liste UNCERTAINTIES. Pas de formule générique ("I hope this message finds you well"), pas de compliment artificiel, pas de jargon IA. Réponds en français.`,
  ].filter(Boolean).join("\n\n");
}

// The single AI call for this participant (docs spec §15) — evidence,
// angle, invitation, and message all come back together, never separate
// round-trips, and never a second "verify the AI" call: grounding is
// checked from the same response's own usedFactTypes.
async function generatePersonalization(
  businessContext: BusinessContextRecord | null,
  strategy: CampaignStrategy | null,
  candidate: CandidateFacts,
  guidance?: string,
): Promise<{ evidence: PersonalizationEvidence; outreachAngle: OutreachAngle; invitationNote: string; message: string; aiModel: string | null }> {
  const evidence = buildPersonalizationEvidence(candidate, strategy);
  const provider = getAIProvider();
  if (!provider) return { evidence, ...deterministicFallback(candidate, businessContext, strategy, evidence), aiModel: null };

  try {
    const result = await provider.generateStructured<{ outreachAngle: OutreachAngle; invitation: { text: string; usedFactTypes: string[] }; message: { text: string; usedFactTypes: string[] } }>({
      system: "Tu écris des messages de prospection LinkedIn humains, courts et fondés STRICTEMENT sur les OBSERVED FACTS fournis. QUALIFICATION CONTEXT et CAMPAIGN STRATEGY sont du contexte interne, jamais des faits à affirmer sur la personne. Formule toute idée non directement observée comme une question, jamais une affirmation. Réponds en français.",
      prompt: buildGenerationPrompt(businessContext, strategy, evidence, guidance),
      schemaName: "PersonalizationGeneration",
      schema: GENERATION_SCHEMA,
      maxTokens: 1000,
    });

    const observedTypes = new Set(evidence.observedFacts.map((fact) => fact.type));
    const fallback = deterministicFallback(candidate, businessContext, strategy, evidence);

    const invitationGrounded = isGroundedText(result.data.invitation.text, result.data.invitation.usedFactTypes, observedTypes) && !containsUnsupportedClaim(result.data.invitation.text);
    const messageGrounded = isGroundedText(result.data.message.text, result.data.message.usedFactTypes, observedTypes) && !containsUnsupportedClaim(result.data.message.text);

    return {
      evidence,
      outreachAngle: result.data.outreachAngle,
      invitationNote: (invitationGrounded ? result.data.invitation.text : fallback.invitationNote).slice(0, 300),
      message: messageGrounded ? result.data.message.text : fallback.message,
      aiModel: result.model,
    };
  } catch {
    return { evidence, ...deterministicFallback(candidate, businessContext, strategy, evidence), aiModel: null };
  }
}

export async function getParticipantPersonalization(context: WorkspaceContext, campaignId: string, participantId: string): Promise<ParticipantPersonalization | null> {
  const result = await database.query<{ personalization: unknown }>(
    `select p.personalization from campaign_participants p join campaigns c on c.id=p.campaign_id where c.workspace_id=$1 and c.id=$2 and p.id=$3`,
    [context.workspaceId, campaignId, participantId],
  );
  if (!result.rows[0]) return null;
  const personalization = result.rows[0].personalization === null ? emptyPersonalization() : normalizePersonalization(result.rows[0].personalization);
  if (personalization.messages.length > 1) {
    // mergeMessageArtifact() appends whatever it just touched to the end of
    // the array — harmless for the executor (it looks up by stepId, never
    // by index) but display order needs the real sequence order, i.e. a
    // follow-up regenerated after its predecessor was approved must not
    // visually jump ahead of it. campaign_steps.position is the one source
    // of truth for that order (docs spec §2).
    const stepOrder = await database.query<{ id: string; position: number }>(`select id,position from campaign_steps where campaign_id=$1 and step_type='message'`, [campaignId]);
    const positionOf = new Map(stepOrder.rows.map((row) => [row.id, row.position]));
    personalization.messages = [...personalization.messages].sort((a, b) => (positionOf.get(a.stepId) ?? 0) - (positionOf.get(b.stepId) ?? 0));
  }
  return personalization;
}

async function savePersonalization(context: WorkspaceContext, campaignId: string, participantId: string, personalization: ParticipantPersonalization): Promise<boolean> {
  const result = await database.query(
    `update campaign_participants p set personalization=$1 from campaigns c where c.id=p.campaign_id and c.workspace_id=$2 and c.id=$3 and p.id=$4`,
    [JSON.stringify(personalization), context.workspaceId, campaignId, participantId],
  );
  return (result.rowCount ?? 0) > 0;
}

function mergeMessageArtifact(existing: MessageArtifact[], stepId: string, generatedText: string): MessageArtifact[] {
  const current = existing.find((artifact) => artifact.stepId === stepId);
  if (current?.status === "approved") return existing; // never silently overwrite an approved message (docs spec §9/§16)
  const next: MessageArtifact = { stepId, status: "generated", generatedText, editedText: null, approvedText: null, approvedAt: null };
  return [...existing.filter((artifact) => artifact.stepId !== stepId), next];
}

export type GenerateOutcome = { ok: true; personalization: ParticipantPersonalization } | { ok: false; reason: ReasonCode };

// Regeneration (§16): factual evidence is rebuilt fresh every time (it's
// cheap and deterministic), but an already-*approved* invitation or message
// is never replaced — only a not-yet-approved one is overwritten with the
// new proposal, which itself starts back at 'generated', requiring a fresh
// approval before it becomes executable.
export async function generateParticipantPersonalization(context: WorkspaceContext, campaignId: string, participantId: string): Promise<GenerateOutcome> {
  const participantRow = await database.query<{ contact_id: string }>(
    `select p.contact_id from campaign_participants p join campaigns c on c.id=p.campaign_id where c.workspace_id=$1 and c.id=$2 and p.id=$3`,
    [context.workspaceId, campaignId, participantId],
  );
  const participant = participantRow.rows[0];
  if (!participant) return { ok: false, reason: "NOT_ELIGIBLE" };

  const candidateRow = await database.query<{ name: string; headline: string | null; role: string | null; company: string | null; location: string | null; profile_url: string | null; qualification: CandidateQualification | null }>(
    `select name,headline,role,company,location,profile_url,qualification from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and contact_id=$3 and status='approved' limit 1`,
    [context.workspaceId, campaignId, participant.contact_id],
  );
  const candidate = candidateRow.rows[0];
  if (!candidate) return { ok: false, reason: "NO_PERSONALIZATION_DATA" };

  const strategy = await getCampaignStrategy(context, campaignId);
  const businessContext = await getActiveBusinessContext(context);
  // ALL message-type steps in order — a follow-up (docs spec §9) is just
  // another step of type 'message', not a second mechanism.
  const messageSteps = await database.query<{ id: string; message_template: string | null }>(
    `select id,message_template from campaign_steps where campaign_id=$1 and step_type='message' order by position`,
    [campaignId],
  );
  const firstStep = messageSteps.rows[0];

  let generated;
  try {
    generated = await generatePersonalization(businessContext, strategy, candidate, firstStep?.message_template ?? undefined);
  } catch {
    return { ok: false, reason: "AI_GENERATION_FAILED" };
  }

  const existing = (await getParticipantPersonalization(context, campaignId, participantId)) ?? emptyPersonalization();
  const now = new Date().toISOString();

  let messages = existing.messages;
  if (firstStep) messages = mergeMessageArtifact(messages, firstStep.id, generated.message);
  const bestText = (stepId: string): string | null => {
    const artifact = messages.find((entry) => entry.stepId === stepId);
    return artifact?.approvedText ?? artifact?.editedText ?? artifact?.generatedText ?? null;
  };
  let previousStepText = (firstStep && bestText(firstStep.id)) ?? generated.message;

  // Follow-ups (position > first message step) are generated in order, each
  // referencing the best known text of the one before it for continuity
  // (docs spec §12) — one AI call per not-yet-approved follow-up, never a
  // second verification call, and an already-approved step is never
  // regenerated (docs spec §16/§28), only kept as continuity context.
  for (let index = 1; index < messageSteps.rows.length; index += 1) {
    const step = messageSteps.rows[index]!;
    const current = messages.find((entry) => entry.stepId === step.id);
    if (current?.status !== "approved") {
      const followUp = await generateFollowUpArtifact(businessContext, candidate, generated.evidence, generated.outreachAngle, previousStepText, step.message_template ?? undefined);
      messages = mergeMessageArtifact(messages, step.id, followUp.text);
    }
    previousStepText = bestText(step.id) ?? previousStepText;
  }

  const next: ParticipantPersonalization = {
    evidence: generated.evidence,
    outreachAngle: generated.outreachAngle,
    invitation: existing.invitation.status === "approved" ? existing.invitation : { status: "generated", generatedText: generated.invitationNote, editedText: null, approvedText: null, approvedAt: null },
    messages,
    generatedAt: now,
    aiModel: generated.aiModel,
  };
  const ok = await savePersonalization(context, campaignId, participantId, next);
  if (!ok) return { ok: false, reason: "NOT_ELIGIBLE" };
  return { ok: true, personalization: next };
}

// WhatsApp minimal executor spec §3: a WhatsApp participant is an existing
// Contact, never a row in campaign_prospect_candidates (that table is
// LinkedIn-search-specific) — so this never touches it, and never calls the
// AI evidence-grounding pipeline above at all. There is nothing to
// hallucinate because there is nothing generated beyond substituting the
// Contact's own real, already-known fields into the step's own
// human-authored message_template; an unknown field degrades to a safe,
// generic phrase, never an invented company/problem/intent. Storage,
// mergeMessageArtifact's never-overwrite-approved rule, and the human
// approval requirement are all reused unchanged from the pipeline above.
type WhatsAppContactFacts = { name: string; firstName: string; company: string | null };

function substituteContactPlaceholders(template: string, contact: WhatsAppContactFacts): string {
  return template
    .replaceAll("{first_name}", contact.firstName || contact.name)
    .replaceAll("{company}", contact.company || "votre entreprise");
}

function deterministicWhatsAppMessage(contact: WhatsAppContactFacts): string {
  return `Bonjour ${contact.firstName || contact.name}, je me permets de revenir vers vous.`;
}

export async function generateWhatsAppParticipantPersonalization(context: WorkspaceContext, campaignId: string, participantId: string): Promise<GenerateOutcome> {
  const participantRow = await database.query<{ contact_id: string }>(
    `select p.contact_id from campaign_participants p join campaigns c on c.id=p.campaign_id where c.workspace_id=$1 and c.id=$2 and p.id=$3`,
    [context.workspaceId, campaignId, participantId],
  );
  const participant = participantRow.rows[0];
  if (!participant) return { ok: false, reason: "NOT_ELIGIBLE" };

  const contactRow = await database.query<{ first_name: string; display_name: string; company: string | null }>(
    `select ct.first_name,ct.display_name,co.name company from contacts ct left join companies co on co.id=ct.company_id and co.workspace_id=ct.workspace_id where ct.workspace_id=$1 and ct.id=$2`,
    [context.workspaceId, participant.contact_id],
  );
  const contactData = contactRow.rows[0];
  if (!contactData) return { ok: false, reason: "NOT_ELIGIBLE" };
  const contact: WhatsAppContactFacts = { name: contactData.display_name, firstName: contactData.first_name, company: contactData.company };

  const messageSteps = await database.query<{ id: string; message_template: string | null }>(
    `select id,message_template from campaign_steps where campaign_id=$1 and step_type='message' order by position`,
    [campaignId],
  );
  if (messageSteps.rows.length === 0) return { ok: false, reason: "NO_STEP_CONFIGURED" };

  const observedFacts: ObservedFact[] = [{ type: "name", value: contact.name, source: "contact" }];
  if (contact.company) observedFacts.push({ type: "company", value: contact.company, source: "contact" });

  const existing = (await getParticipantPersonalization(context, campaignId, participantId)) ?? emptyPersonalization();
  let messages = existing.messages;
  for (const step of messageSteps.rows) {
    const current = messages.find((entry) => entry.stepId === step.id);
    if (current?.status === "approved") continue; // never silently overwrite an approved message (docs spec §9/§16)
    const text = step.message_template?.trim()
      ? substituteContactPlaceholders(step.message_template, contact).slice(0, 1000)
      : deterministicWhatsAppMessage(contact);
    messages = mergeMessageArtifact(messages, step.id, text);
  }

  const next: ParticipantPersonalization = {
    evidence: { observedFacts, qualificationContext: null, strategyContext: null, uncertainties: [] },
    outreachAngle: existing.outreachAngle,
    invitation: existing.invitation,
    messages,
    generatedAt: new Date().toISOString(),
    aiModel: null,
  };
  const ok = await savePersonalization(context, campaignId, participantId, next);
  if (!ok) return { ok: false, reason: "NOT_ELIGIBLE" };
  return { ok: true, personalization: next };
}

const GENERATION_CONCURRENCY = 3;

// Controlled concurrency, not a sequential cascade, not a distributed job
// system (docs spec §15) — small chunks of Promise.all over whichever
// participants still need a first proposal (or an explicit re-generation
// list).
export async function generatePersonalizationForCampaign(context: WorkspaceContext, campaignId: string, participantIds?: string[]): Promise<{ generated: number; failed: number }> {
  const targets = participantIds?.length
    ? participantIds
    : (await database.query<{ id: string }>(
        `select p.id from campaign_participants p join campaigns c on c.id=p.campaign_id
         where c.workspace_id=$1 and c.id=$2 and (p.personalization is null or p.personalization->'invitation'->>'status'='not_generated')`,
        [context.workspaceId, campaignId],
      )).rows.map((row) => row.id);

  let generated = 0;
  let failed = 0;
  for (let index = 0; index < targets.length; index += GENERATION_CONCURRENCY) {
    const chunk = targets.slice(index, index + GENERATION_CONCURRENCY);
    const results = await Promise.all(chunk.map((participantId) => generateParticipantPersonalization(context, campaignId, participantId)));
    for (const result of results) { if (result.ok) generated += 1; else failed += 1; }
  }
  return { generated, failed };
}

// Human edits are never run through isGroundedText/containsUnsupportedClaim
// (docs spec §10) — the human is responsible for their own text, exactly as
// before.
export async function editParticipantInvitation(context: WorkspaceContext, campaignId: string, participantId: string, text: string): Promise<ParticipantPersonalization | null> {
  const existing = await getParticipantPersonalization(context, campaignId, participantId);
  if (!existing) return null;
  const next: ParticipantPersonalization = { ...existing, invitation: { ...existing.invitation, status: "edited", editedText: text } };
  return (await savePersonalization(context, campaignId, participantId, next)) ? next : null;
}

export async function approveParticipantInvitation(context: WorkspaceContext, campaignId: string, participantId: string): Promise<ParticipantPersonalization | null> {
  const existing = await getParticipantPersonalization(context, campaignId, participantId);
  const finalText = existing?.invitation.editedText ?? existing?.invitation.generatedText;
  if (!existing || !finalText) return null;
  const next: ParticipantPersonalization = { ...existing, invitation: { ...existing.invitation, status: "approved", approvedText: finalText, approvedAt: new Date().toISOString() } };
  return (await savePersonalization(context, campaignId, participantId, next)) ? next : null;
}

export async function editParticipantMessage(context: WorkspaceContext, campaignId: string, participantId: string, stepId: string, text: string): Promise<ParticipantPersonalization | null> {
  const existing = await getParticipantPersonalization(context, campaignId, participantId);
  if (!existing) return null;
  const current = existing.messages.find((artifact) => artifact.stepId === stepId) ?? { stepId, ...EMPTY_TEXT };
  const messages = [...existing.messages.filter((artifact) => artifact.stepId !== stepId), { ...current, status: "edited" as const, editedText: text }];
  const next: ParticipantPersonalization = { ...existing, messages };
  return (await savePersonalization(context, campaignId, participantId, next)) ? next : null;
}

export async function approveParticipantMessage(context: WorkspaceContext, campaignId: string, participantId: string, stepId: string): Promise<ParticipantPersonalization | null> {
  const existing = await getParticipantPersonalization(context, campaignId, participantId);
  if (!existing) return null;
  const current = existing.messages.find((artifact) => artifact.stepId === stepId);
  const finalText = current?.editedText ?? current?.generatedText;
  if (!current || !finalText) return null;
  const messages = [...existing.messages.filter((artifact) => artifact.stepId !== stepId), { ...current, status: "approved" as const, approvedText: finalText, approvedAt: new Date().toISOString() }];
  const next: ParticipantPersonalization = { ...existing, messages };
  return (await savePersonalization(context, campaignId, participantId, next)) ? next : null;
}

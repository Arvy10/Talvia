import { database } from "./database";
import { getAIProvider } from "./ai";
import { getCampaignStrategy, type CampaignChannel, type CampaignObjective } from "./campaigns";
import type { CampaignStrategy } from "./campaign-strategy";
import { getActiveBusinessContext, type BusinessContextRecord } from "./business-context/business-context-service";
import type { CandidateQualification } from "./prospecting";
import type { ReasonCode } from "./campaign-execution/reason-codes";
import type { WorkspaceContext } from "./workspace-context";
import { buildChannelConversationContext } from "./campaign-execution/conversation-context";

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

// --- OFFERING ---
// What the SENDER may legitimately assert about itself. A projection of the
// Business Context record that already exists — not a copy of it, not a new
// table, no migration: every field below is read straight from
// business_contexts, which has carried them since 008_business_context.sql.
// They were loaded and then dropped before reaching the generator, which is
// exactly why a prospecting message had nothing commercial to say.
//
// ScoredField values are unwrapped to their `.value` here: provenance and
// confidence govern whether a human trusts the Business Context screen, not
// whether a sentence may state what the company sells.
export type Offering = {
  companyName: string | null;
  businessDescription: string | null;
  valueProposition: string | null;
  services: string[];
  products: string[];
  painPoints: string[];
  salesAngles: string[];
};

// The named fields a generated sentence may cite as "this claim is about our
// own offer". Anything outside this list is, by construction, something
// Talvia does not know — see isSupportedOfferingUse.
export type OfferingField = keyof Offering;

const EMPTY_OFFERING: Offering = {
  companyName: null, businessDescription: null, valueProposition: null,
  services: [], products: [], painPoints: [], salesAngles: [],
};

export function buildOffering(businessContext: BusinessContextRecord | null): Offering {
  if (!businessContext) return { ...EMPTY_OFFERING };
  return {
    companyName: businessContext.companyName,
    businessDescription: businessContext.businessDescription,
    valueProposition: businessContext.valueProposition?.value ?? null,
    services: businessContext.services ?? [],
    products: businessContext.products ?? [],
    painPoints: businessContext.painPoints?.value ?? [],
    salesAngles: businessContext.salesAngles?.value ?? [],
  };
}

// Which offering fields actually carry something. A model citing a field
// that is empty is citing something Talvia never knew.
export function populatedOfferingFields(offering: Offering): Set<OfferingField> {
  const filled = new Set<OfferingField>();
  if (offering.companyName?.trim()) filled.add("companyName");
  if (offering.businessDescription?.trim()) filled.add("businessDescription");
  if (offering.valueProposition?.trim()) filled.add("valueProposition");
  if (offering.services.length) filled.add("services");
  if (offering.products.length) filled.add("products");
  if (offering.painPoints.length) filled.add("painPoints");
  if (offering.salesAngles.length) filled.add("salesAngles");
  return filled;
}

export function hasSellableOffering(offering: Offering): boolean {
  const filled = populatedOfferingFields(offering);
  return filled.has("valueProposition") || filled.has("products") || filled.has("services") || filled.has("businessDescription");
}

// --- CAMPAIGN INTENT ---
// campaigns.objective is an existing enum column that this path never read —
// so a prospecting campaign, a follow-up and a reactivation all produced the
// same text. It is not a tone setting: it decides what the message is FOR,
// and therefore what next step it may legitimately propose.
//
// `goal`/`stance`/`nextStep` are inputs to a generator, never sentences to
// paste into a message (rule 7: the model chooses its own wording).
export type CampaignIntent = {
  objective: CampaignObjective;
  goal: string;
  stance: string;
  nextStep: string;
};

const CAMPAIGN_INTENTS: Record<CampaignObjective, Omit<CampaignIntent, "objective">> = {
  prospecting: {
    goal: "Faire découvrir ce que propose l'expéditeur et donner une raison concrète d'y prêter attention maintenant.",
    stance: "Première prise de contact : la personne ne connaît pas l'expéditeur. C'est à l'expéditeur d'apporter la matière — ce qu'il fait, pour qui, quel problème il traite — pas au prospect de se présenter. Ne demande donc pas au prospect d'expliquer son activité comme substitut à une proposition.",
    nextStep: "Proposer une prochaine étape commerciale légère et concrète (un échange court, une question précise à laquelle répondre).",
  },
  follow_up: {
    goal: "Reprendre le fil d'une relation déjà engagée et faire avancer ce qui était en cours.",
    stance: "La relation existe déjà. Ne te represente pas comme un inconnu et ne réexplique pas l'offre depuis zéro. N'affirme jamais qu'une action précise était promise ou attendue, sauf si une evidence du prospect le prouve.",
    nextStep: "Proposer la suite logique de ce qui était déjà engagé.",
  },
  reactivation: {
    goal: "Renouer un contact devenu inactif en redonnant une raison actuelle de reparler.",
    stance: "Le lien s'est distendu. Reprends contact sans reproche et sans supposer ni expliquer pourquoi la personne n'a pas répondu — le silence ne prouve aucun sentiment ni aucune raison. Un rappel bref de ce que fait l'expéditeur est légitime.",
    nextStep: "Proposer une reprise de contact à faible engagement.",
  },
};

export function buildCampaignIntent(objective: CampaignObjective): CampaignIntent {
  return { objective, ...CAMPAIGN_INTENTS[objective] };
}

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

// C2: how a message artifact's generatedText actually came to be — set only
// by generators that can genuinely distinguish the two (today, WhatsApp's
// grounded pipeline below); left undefined by LinkedIn's own generators, so
// existing behavior/shape is unaffected. Never inferred from aiModel alone
// in the UI — it's the one explicit signal a caller should trust to show
// "based on your conversation" vs "limited personalization" without turning
// PersonalizationCard into a technical dashboard.
export type GenerationMode = "ai_grounded" | "deterministic_fallback";

// One entry per message-type campaign_steps row — an array, not a single
// object, so a future follow-up step needs no further migration (docs spec
// §14).
export type MessageArtifact = GeneratedText & { stepId: string; generationMode?: GenerationMode };

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

// --- SALES ANGLE ---
// Offering x Campaign Intent x Prospect Evidence -> the angle.
//
// Derived by SELECTION over what is actually known, never assembled from a
// fixed list of sentences: each field below picks the most specific real
// datum available and degrades explicitly when nothing is. Two workspaces
// with different Business Contexts therefore get different angles, and a
// workspace with nothing gets an angle that says so instead of inventing a
// reason.
//
// The angle is reasoning, not copy. It steers the generator and is shown to
// the human reviewer; no part of it is pasted into a message.
export function buildSalesAngle(offering: Offering, intent: CampaignIntent, evidence: PersonalizationEvidence): OutreachAngle {
  const factTypes = new Set(evidence.observedFacts.map((fact) => fact.type));
  const filled = populatedOfferingFields(offering);

  // Why this person: the most specific thing genuinely observed about them.
  // Never the campaign's targeting criteria — those describe who is being
  // looked for, not who this person is.
  const roleFact = evidence.observedFacts.find((fact) => fact.type === "role") ?? evidence.observedFacts.find((fact) => fact.type === "headline");
  const companyFact = evidence.observedFacts.find((fact) => fact.type === "company");
  const whyContactThisPerson = roleFact && companyFact
    ? `Fonction observée : ${roleFact.value} — chez ${companyFact.value}.`
    : roleFact
      ? `Fonction observée : ${roleFact.value}.`
      : companyFact
        ? `Entreprise observée : ${companyFact.value}. Fonction inconnue.`
        : "Aucun attribut individuel observé au-delà du nom — l'angle ne peut reposer que sur l'offre.";

  // What we can put in front of them: the most specific offering datum we
  // actually hold, in decreasing order of commercial precision.
  const relevantOffer = filled.has("valueProposition")
    ? offering.valueProposition!
    : filled.has("products")
      ? offering.products.join(", ")
      : filled.has("services")
        ? offering.services.join(", ")
        : filled.has("businessDescription")
          ? offering.businessDescription!
          : "";

  const conversationGoal = relevantOffer
    ? `${intent.goal} ${intent.nextStep}`
    : `${intent.goal} Aucune matière commerciale connue : rester sur une prise de contact honnête, sans décrire d'offre.`;

  const tone = intent.objective === "prospecting"
    ? "direct, concret, sans pression ni flatterie"
    : intent.objective === "reactivation"
      ? "chaleureux, sans reproche, faible engagement"
      : "familier de la relation, orienté suite concrète";

  return {
    whyContactThisPerson,
    relevantOffer,
    // What the angle actually rests on, both sides — the prospect facts used
    // and the offering fields used, so the reviewer sees its real basis.
    evidenceUsed: [...factTypes, ...[...filled].map((field) => `offering:${field}`)],
    conversationGoal,
    tone,
  };
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
// Commercial terms Talvia holds NO field for anywhere in business_contexts:
// price, free trial, duration, discount, guarantee, named social proof. The
// only way such a claim can be legitimate is if the workspace's own offering
// text already says it — so it is checked against that text, not against a
// permission the model grants itself.
const UNSUPPORTED_OFFER_PATTERNS: RegExp[] = [
  /\b\d+\s?(?:€|\$|eur|euros|usd|dollars)\b|\b(?:gratuit|gratuite|sans frais|offert|offerte)\b/i,
  /\bessai\b|\bfree trial\b|\bd[ée]mo gratuite\b/i,
  /\b(?:remise|r[ée]duction|promo(?:tion)?)\b|-\s?\d+\s?%|\d+\s?% de (?:remise|r[ée]duction)/i,
  /\b(?:garantie|remboursement)\b|satisfait ou rembours[ée]/i,
  /\b(?:en|sous) \d+ (?:jours?|semaines?|mois)\b/i,
  /\b\d+\s?(?:clients|entreprises|utilisateurs)\b|\bleader du march[ée]\b|\bn°\s?1\b|\bnum[ée]ro un\b/i,
];

// True when the text makes one of those claims WITHOUT the workspace's own
// offering text containing the same vocabulary. Deliberately conservative:
// a false positive costs a safe fallback, a false negative puts an invented
// commercial promise in front of a real prospect.
function containsUnsupportedOfferClaim(text: string, offering: Offering): boolean {
  const offeringText = [
    offering.businessDescription, offering.valueProposition,
    ...offering.services, ...offering.products, ...offering.painPoints, ...offering.salesAngles,
  ].filter(Boolean).join(" ");
  return UNSUPPORTED_OFFER_PATTERNS.some((pattern) => pattern.test(text) && !pattern.test(offeringText));
}

// The PRIMARY grounding check, now on TWO axes instead of one.
//
// The previous single rule ("a sentence citing no prospect fact is only
// valid if it ends in a question mark") was written when the generator had
// no commercial material at all. It made every non-question assertive
// sentence illegal, so the only legal output for a prospect Talvia knows
// little about was a generic open question — which is precisely the
// "pouvez-vous me parler de votre entreprise ?" failure. The rule was not
// wrong about the PROSPECT; it was applied to statements about OURSELVES,
// where it never belonged.
//
// The two axes are now separate, because their proof obligations are:
//   - a claim about the PROSPECT must be backed by Prospect Evidence;
//   - a claim about OUR company/offer must be backed by a populated
//     OFFERING field;
//   - anything backed by neither may only be a question;
//   - qualification/targeting is neither, and can never license either
//     (enforced upstream: it never enters observedFacts).
function isGroundedText(
  text: string,
  usedFactTypes: string[],
  observedFactTypes: Set<string>,
  usedOfferingFields: string[],
  populatedOffering: Set<OfferingField>,
): boolean {
  // 1. Every cited prospect fact must really have been observed.
  if (!usedFactTypes.every((type) => observedFactTypes.has(type))) return false;
  // 2. Every cited offering field must really carry something. Citing an
  //    empty field is citing something Talvia never knew.
  if (!usedOfferingFields.every((field) => populatedOffering.has(field as OfferingField))) return false;
  // 3. An assertion resting on nothing at all stays illegal — but presenting
  //    our own offer now counts as resting on something.
  const isQuestion = text.trim().endsWith("?");
  if (usedFactTypes.length === 0 && usedOfferingFields.length === 0 && !isQuestion) return false;
  return true;
}

// The no-provider path. It is NOT a lesser copy of the AI path: it reasons
// from the same Sales Angle, and it is honest about being limited.
//
// Two things it must never do again:
//  - throw away the founder's own text. `guidance` is campaign_steps
//    .message_template, i.e. the message the user wrote in the wizard. It
//    used to be forwarded only into the LLM prompt, so with no provider it
//    was silently discarded and replaced by a hardcoded sentence. When it
//    exists it is now the message, with the same {first_name}/{company}
//    substitution the conversation channels already use.
//  - ask the prospect to introduce themselves. In prospecting it is the
//    sender's job to bring the substance; "pouvez-vous me parler de votre
//    entreprise ?" was the symptom of having none to bring.
//
// What it will not do is pretend: with no offering and no guidance it stays
// short and says only what is true, rather than filling the gap.
function deterministicFallback(
  candidate: CandidateFacts,
  offering: Offering,
  intent: CampaignIntent,
  angle: OutreachAngle,
  evidence: PersonalizationEvidence,
  guidance?: string,
): { invitationNote: string; message: string } {
  const firstName = candidate.name.split(/\s+/)[0] || candidate.name;
  const contact = { name: candidate.name, firstName, company: candidate.company ?? null };
  const hasCompany = evidence.observedFacts.some((fact) => fact.type === "company");

  // The founder's own message wins whenever there is one.
  const authored = guidance?.trim() ? substituteContactPlaceholders(guidance, contact).slice(0, 1000) : null;

  // angle.relevantOffer is already the most specific real offering datum
  // available (valueProposition > products > services > businessDescription)
  // — never an invented one, and empty when nothing is known.
  const offer = angle.relevantOffer.trim();
  const opener = intent.objective === "prospecting"
    ? `Bonjour ${firstName},`
    : intent.objective === "reactivation"
      ? `Bonjour ${firstName}, cela fait un moment.`
      : `Bonjour ${firstName}, je reviens vers vous.`;

  const message = authored ?? (offer
    ? [
        opener,
        // Apposition rather than a sentence built around the offer: a
        // valueProposition can be a noun phrase, an infinitive or a full
        // sentence, and only an apposition stays grammatical for all three.
        offering.companyName ? `je travaille chez ${offering.companyName} — ${lowerFirst(offer)}.` : `${offer}.`,
        hasCompany ? `Est-ce un sujet sur lequel vous travaillez chez ${candidate.company} ?` : "Est-ce un sujet qui vous concerne en ce moment ?",
      ].join(" ")
    // Nothing known to present: a short, honest contact rather than a
    // generic question dressed up as personalization.
    : `${opener} je me permets de vous contacter directement. Seriez-vous ouvert a un echange rapide ?`);

  const invitationNote = (authored && intent.objective !== "prospecting"
    ? authored
    : offering.companyName
      ? `Bonjour ${firstName}, je travaille chez ${offering.companyName}${offer ? ` — ${lowerFirst(offer)}` : ""}. Ravi d'echanger !`
      : `Bonjour ${firstName}, ravi d'echanger avec vous !`
  ).slice(0, 300);

  return { invitationNote, message };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

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

type GeneratedArtifact = { text: string; usedFactTypes: string[]; usedOfferingFields: string[] };

const GENERATED_ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    // The model's own account of which observed-fact types it actually
    // relied on — validated server-side by isGroundedText(), never trusted
    // blindly (docs spec §6).
    usedFactTypes: { type: "array", items: { type: "string" } },
    // The second grounding axis: which OFFERING fields this text asserts
    // something from. Validated the same way — a field named here must
    // genuinely carry data. Separate from usedFactTypes on purpose: one
    // proves a claim about the prospect, the other a claim about us, and
    // conflating them is what let "our offer" borrow the prospect's proof.
    usedOfferingFields: { type: "array", items: { type: "string", enum: ["companyName", "businessDescription", "valueProposition", "services", "products", "painPoints", "salesAngles"] } },
  },
  required: ["text", "usedFactTypes", "usedOfferingFields"],
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
function buildOfferingBlock(offering: Offering): string {
  const lines = [
    offering.companyName ? `- companyName : ${offering.companyName}` : null,
    offering.businessDescription ? `- businessDescription : ${offering.businessDescription}` : null,
    offering.valueProposition ? `- valueProposition : ${offering.valueProposition}` : null,
    offering.products.length ? `- products : ${offering.products.join(", ")}` : null,
    offering.services.length ? `- services : ${offering.services.join(", ")}` : null,
    offering.painPoints.length ? `- painPoints (problemes que l'expediteur traite) : ${offering.painPoints.join(" ; ")}` : null,
    offering.salesAngles.length ? `- salesAngles (angles commerciaux connus) : ${offering.salesAngles.join(" ; ")}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(aucune information commerciale connue sur l'expediteur)";
}

// The generator's whole input, in the order the model reads it: what we know
// about the prospect, what we know about ourselves, what this campaign is
// for, and the angle Talvia derived from the three. The two evidence regimes
// are separate blocks with separate proof obligations, and the two blocks
// that license NEITHER (qualification, targeting) say so in their own header.
function buildGenerationPrompt(offering: Offering, intent: CampaignIntent, angle: OutreachAngle, evidence: PersonalizationEvidence, guidance?: string): string {
  const observed = evidence.observedFacts.map((fact) => `- ${fact.type}: ${fact.value}`).join("\n") || "(aucun fait observe)";
  const qualification = evidence.qualificationContext
    ? `Score: ${evidence.qualificationContext.score}/100, fit: ${evidence.qualificationContext.fit}. Raisons internes: ${evidence.qualificationContext.reasons.join("; ") || "aucune"}. Incertitudes internes: ${evidence.qualificationContext.uncertainties.join("; ") || "aucune"}.`
    : "(aucune qualification disponible)";
  const strategyBlock = evidence.strategyContext
    ? [
        `Roles recherches par la campagne (en general) : ${evidence.strategyContext.targetRoles.join(", ") || "non precise"}.`,
        `Types d'entreprises recherches (en general) : ${evidence.strategyContext.companyTypes.join(", ") || "non precise"}.`,
        `Secteurs recherches (en general) : ${evidence.strategyContext.industries.join(", ") || "non precise"}.`,
      ].join("\n")
    : "(aucune strategie disponible)";
  const uncertainties = evidence.uncertainties.length ? evidence.uncertainties.map((note) => `- ${note}`).join("\n") : "(aucune)";

  const instructions = [
    "INSTRUCTIONS :",
    "Redige : 1) une note d'invitation LinkedIn courte (300 caracteres maximum, faible pression) ; 2) un premier message post-acceptation, court et conversationnel.",
    "",
    "DEUX REGIMES DE PREUVE, a ne jamais confondre :",
    "- Toute affirmation sur LE PROSPECT (sa fonction, son entreprise, sa situation, ses besoins, ses intentions) exige un element de PROSPECT EVIDENCE. Sans preuve : formule-la en QUESTION OUVERTE, ou ne la dis pas.",
    "- Toute affirmation sur VOTRE ENTREPRISE OU VOTRE OFFRE exige une information correspondante dans OFFERING. Avec elle, affirme-la directement : c'est le contenu commercial attendu.",
    "- QUALIFICATION CONTEXT et CAMPAIGN TARGETING ne justifient NI l'un NI l'autre.",
    "",
    "INTERDIT ABSOLU : inventer un prix, un tarif, une gratuite, un essai, une duree, un delai, une remise, une promotion, une garantie, un remboursement, une fonctionnalite, un chiffre ou une preuve sociale (nombre de clients, position sur le marche) qui ne figure pas dans OFFERING. Si tu ne le sais pas, ne le dis pas : n'ecris pas d'approximation, ne comble pas le vide.",
    "",
    "N'utilise PAS « pouvez-vous me parler de votre entreprise ? » ni aucune variante qui demande au prospect de faire le travail de presentation a ta place : en prospection, c'est a l'expediteur d'apporter la matiere. Si OFFERING est vide, reste sur une prise de contact courte et honnete plutot que sur une question generique de remplissage.",
    "",
    "Choisis toi-meme la structure et l'accroche : aucune formule imposee. Pas de « I hope this message finds you well », pas de compliment artificiel, pas de jargon IA.",
    "",
    "Pour CHAQUE texte, renseigne usedFactTypes (les types de PROSPECT EVIDENCE reellement utilises) et usedOfferingFields (les champs d'OFFERING reellement utilises). Ces deux listes sont verifiees cote serveur : citer un element absent invalide le texte. Reponds en francais.",
  ].join("\n");

  return [
    `=== PROSPECT EVIDENCE (faits directement observes sur CE prospect - la SEULE base autorisee pour affirmer quelque chose LE concernant) ===\n${observed}`,
    `=== OFFERING (ce que vend l'expediteur - la SEULE base autorisee pour affirmer quelque chose sur VOTRE entreprise ou votre offre) ===\nCes informations sont verifiees et viennent du Business Context du workspace. Tu PEUX les affirmer telles quelles : decrire ce que fait l'expediteur, ce qu'il propose et quels problemes il traite est legitime et attendu.\n${buildOfferingBlock(offering)}`,
    `=== CAMPAIGN INTENT (objectif commercial de CETTE campagne : ${intent.objective}) ===\nBut : ${intent.goal}\nPosture : ${intent.stance}\nProchaine etape a provoquer : ${intent.nextStep}`,
    `=== SALES ANGLE (raisonnement interne prepare par Talvia - une orientation, PAS un texte a recopier) ===\nPourquoi cette personne : ${angle.whyContactThisPerson}\nCe qui peut lui etre presente : ${angle.relevantOffer || "(rien de connu)"}\nObjectif de la conversation : ${angle.conversationGoal}\nTon : ${angle.tone}`,
    `=== QUALIFICATION CONTEXT (analyse interne Talvia - NI un fait sur le prospect, NI une information sur l'offre) ===\nA utiliser uniquement pour juger de la pertinence. Ne presente JAMAIS ces conclusions comme des faits observes sur la personne.\n${qualification}`,
    `=== CAMPAIGN TARGETING (qui la campagne cherche en general - PAS un fait sur ce prospect precis) ===\nCela ne prouve RIEN sur les attributs individuels de cette personne : si le ciblage vise des "agences" et que l'entreprise observee est "Acme", cela ne veut PAS dire qu'Acme est une agence.\n${strategyBlock}`,
    `=== UNCERTAINTIES / UNKNOWN ===\nCes elements sont explicitement inconnus. Ne les transforme JAMAIS en affirmation.\n${uncertainties}`,
    guidance ? `=== CONSIGNE DU FONDATEUR (intention redactionnelle a respecter, pas un texte a recopier tel quel) ===\n${guidance}` : null,
    instructions,
  ].filter(Boolean).join("\n\n");
}

// Offering x Campaign Intent x Prospect Evidence -> Sales Angle -> Message.
// The angle is derived first and passed to BOTH paths, so the deterministic
// fallback and the model reason from the same basis and differ only in how
// well they write it.
async function generatePersonalization(
  offering: Offering,
  intent: CampaignIntent,
  strategy: CampaignStrategy | null,
  candidate: CandidateFacts,
  guidance?: string,
): Promise<{ evidence: PersonalizationEvidence; outreachAngle: OutreachAngle; invitationNote: string; message: string; invitationMode: GenerationMode; messageMode: GenerationMode; aiModel: string | null }> {
  const evidence = buildPersonalizationEvidence(candidate, strategy);
  const angle = buildSalesAngle(offering, intent, evidence);
  const fallback = () => deterministicFallback(candidate, offering, intent, angle, evidence, guidance);
  const provider = getAIProvider();
  // No provider configured is not a hidden condition: the texts below are
  // the deterministic ones, and they are labelled as such all the way to the
  // UI (generationMode) instead of being passed off as AI output.
  if (!provider) return { evidence, outreachAngle: angle, ...fallback(), invitationMode: "deterministic_fallback", messageMode: "deterministic_fallback", aiModel: null };

  try {
    const result = await provider.generateStructured<{ invitation: GeneratedArtifact; message: GeneratedArtifact }>({
      system: "Tu ecris des messages de prospection LinkedIn humains et courts. Deux regimes de preuve distincts : toute affirmation sur le PROSPECT exige un element de PROSPECT EVIDENCE, toute affirmation sur l'entreprise ou l'offre de l'EXPEDITEUR exige un champ correspondant d'OFFERING. Presenter ce que vend l'expediteur est legitime et attendu. QUALIFICATION CONTEXT et CAMPAIGN TARGETING ne justifient aucune des deux. N'invente jamais un prix, une gratuite, une duree, une remise, une garantie, une fonctionnalite ou une preuve sociale absente d'OFFERING. Reponds en francais.",
      prompt: buildGenerationPrompt(offering, intent, angle, evidence, guidance),
      schemaName: "PersonalizationGeneration",
      schema: GENERATION_SCHEMA,
      maxTokens: 1000,
    });

    const observedTypes = new Set(evidence.observedFacts.map((fact) => fact.type));
    const filledOffering = populatedOfferingFields(offering);
    const safe = fallback();

    // Both axes, plus both "never invent" nets: the prospect-side one that
    // already existed, and the offer-side one this pass adds.
    // `?? []` on both lists: a model that omits one is claiming to cite
    // nothing from it, which is the safe reading — never a crash, and never
    // an implicit pass.
    const accept = (artifact: GeneratedArtifact) =>
      isGroundedText(artifact.text, artifact.usedFactTypes ?? [], observedTypes, artifact.usedOfferingFields ?? [], filledOffering)
      && !containsUnsupportedClaim(artifact.text)
      && !containsUnsupportedOfferClaim(artifact.text, offering);

    const invitationGrounded = accept(result.data.invitation);
    const messageGrounded = accept(result.data.message);

    return {
      evidence,
      // The angle stays Talvia's own derivation. Letting the model return it
      // would make the reviewer's stated rationale whatever the model felt
      // like claiming, including for a text that validation then rejected.
      outreachAngle: angle,
      invitationNote: (invitationGrounded ? result.data.invitation.text : safe.invitationNote).slice(0, 300),
      message: messageGrounded ? result.data.message.text : safe.message,
      invitationMode: invitationGrounded ? "ai_grounded" : "deterministic_fallback",
      messageMode: messageGrounded ? "ai_grounded" : "deterministic_fallback",
      // Reported only when at least one text the caller actually receives
      // came from the model. A generation that was produced and then
      // REJECTED by grounding validation must not leave a model name behind
      // as if it had authored the deterministic text that replaced it.
      aiModel: invitationGrounded || messageGrounded ? result.model : null,
    };
  } catch {
    return { evidence, outreachAngle: angle, ...fallback(), invitationMode: "deterministic_fallback", messageMode: "deterministic_fallback", aiModel: null };
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

function mergeMessageArtifact(existing: MessageArtifact[], stepId: string, generatedText: string, generationMode?: GenerationMode): MessageArtifact[] {
  const current = existing.find((artifact) => artifact.stepId === stepId);
  if (current?.status === "approved") return existing; // never silently overwrite an approved message (docs spec §9/§16)
  const next: MessageArtifact = { stepId, status: "generated", generatedText, editedText: null, approvedText: null, approvedAt: null, ...(generationMode ? { generationMode } : {}) };
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
  // The commercial substance of the Business Context, projected into the
  // shape the generator can actually cite. Previously only companyName and
  // businessDescription survived this far — valueProposition, products,
  // services, painPoints and salesAngles were loaded from the same row and
  // dropped, which is why a prospecting message had nothing to propose.
  const offering = buildOffering(businessContext);
  // campaigns.objective: an existing column this path never read, so
  // prospecting, follow_up and reactivation produced identical text.
  const campaignRow = await database.query<{ objective: CampaignObjective }>(
    `select objective from campaigns where workspace_id=$1 and id=$2`,
    [context.workspaceId, campaignId],
  );
  const intent = buildCampaignIntent(campaignRow.rows[0]?.objective ?? "prospecting");
  // ALL message-type steps in order — a follow-up (docs spec §9) is just
  // another step of type 'message', not a second mechanism.
  const messageSteps = await database.query<{ id: string; message_template: string | null }>(
    `select id,message_template from campaign_steps where campaign_id=$1 and step_type='message' order by position`,
    [campaignId],
  );
  const firstStep = messageSteps.rows[0];

  let generated;
  try {
    generated = await generatePersonalization(offering, intent, strategy, candidate, firstStep?.message_template ?? undefined);
  } catch {
    return { ok: false, reason: "AI_GENERATION_FAILED" };
  }

  const existing = (await getParticipantPersonalization(context, campaignId, participantId)) ?? emptyPersonalization();
  const now = new Date().toISOString();

  let messages = existing.messages;
  if (firstStep) messages = mergeMessageArtifact(messages, firstStep.id, generated.message, generated.messageMode);
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
      messages = mergeMessageArtifact(messages, step.id, followUp.text, followUp.aiModel ? "ai_grounded" : "deterministic_fallback");
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
// LinkedIn-search-specific) — so this never touches it. Unlike LinkedIn,
// there is no candidate-search step to draw structured attributes from — the
// only genuine source of evidence about the prospect is the real WhatsApp
// Conversation already exchanged with them (C1's buildWhatsAppConversationContext).
// Deterministic Contact-field substitution (below) remains the fallback in
// every case where that evidence is absent, insufficient, or the generated
// proposal fails grounding — never an invented company/problem/intent.
// Storage, mergeMessageArtifact's never-overwrite-approved rule, and the
// human approval requirement are all reused unchanged from the pipeline
// above.
type WhatsAppContactFacts = { name: string; firstName: string; company: string | null };

function substituteContactPlaceholders(template: string, contact: WhatsAppContactFacts): string {
  return template
    .replaceAll("{first_name}", contact.firstName || contact.name)
    .replaceAll("{company}", contact.company || "votre entreprise");
}

function deterministicWhatsAppMessage(contact: WhatsAppContactFacts): string {
  return `Bonjour ${contact.firstName || contact.name}, je me permets de revenir vers vous.`;
}

// C2 — grounded WhatsApp personalization. server-owned evidence -> structured
// generation -> server-side claim/evidence validation -> grounded proposal OR
// deterministic fallback. No change to how approvedText is produced/consumed
// afterward (edit/approve/executor are all untouched).

// One evidence per real, non-empty WhatsApp message — never a summary, never
// an inference, never fabricated. `evidenceId` is positional and
// deterministic (C1's recentMessages is already ordered oldest->newest with
// its own deterministic tie-break), scoped to a single generation call only
// — never persisted, never reused across calls, so it needs no relation to
// the real messages.id.
export type WhatsAppEvidence = { evidenceId: string; direction: "inbound" | "outbound"; text: string; at: string };

// Attachment-only / genuinely empty messages carry no textual claim to make
// — never turned into a synthesized placeholder (C1 already preserves body
// as-is; this is where an empty one is simply excluded from evidence).
function buildWhatsAppEvidence(recentMessages: Array<{ direction: "inbound" | "outbound"; body: string; at: string }>): WhatsAppEvidence[] {
  return recentMessages
    .filter((message) => message.body.trim() !== "")
    .map((message, index) => ({ evidenceId: `e${index}`, direction: message.direction, text: message.body, at: message.at }));
}

// C2 correction — closes a structural gap found in the first C2 review: a
// free `text` field plus an independent, self-declared `claims[]` gave the
// model a way to write a factual assertion inside `text` without declaring
// it as a claim at all — invisible to claim validation, and only caught by
// the backstop regex if it happened to use one of a closed list of French
// words. A reformulation of real evidence in different words (the realistic
// failure mode for an LLM, which paraphrases far more often than it invents
// from nothing) could slip through undetected. Fixed not by adding more
// regex, but by removing the free-text field entirely: the model now
// returns an ORDERED list of segments, each explicitly typed "generic" (no
// claim about the prospect — greeting, pleasantry, open question) or
// "factual" (a new assertion about the prospect/conversation, mandatorily
// evidence-backed). The server reconstructs the final text by concatenating
// only segments it has individually validated — there is no longer any
// span of the output text that isn't accounted for by one of these two
// checked categories.
type WhatsAppSegmentKind = "generic" | "factual";
type WhatsAppSegment = { kind: WhatsAppSegmentKind; text: string; supportedByEvidenceIds: string[] };
type WhatsAppGenerationOutput = { segments: WhatsAppSegment[]; uncertain: boolean };

const MAX_WHATSAPP_TEXT_LENGTH = 320;
// An email is correspondence, not a chat bubble: the same grounding rules
// apply verbatim, only the room to say it differs. Still a hard reject, never
// a truncation.
const MAX_EMAIL_TEXT_LENGTH = 1200;

// What differs between two channels that both ground on a real message
// history — and nothing else. Every validation rule, the segment schema, the
// evidence construction and the fallback are shared: a second copy of them
// per channel is exactly the duplication that lets two channels' safety
// rules drift apart.
type ConversationChannelPolicy = {
  channel: CampaignChannel;
  // Used in the prompt only, so the model writes in the right register.
  label: string;
  maxTextLength: number;
  system: string;
};

const WHATSAPP_POLICY: ConversationChannelPolicy = {
  channel: "whatsapp",
  label: "WhatsApp",
  maxTextLength: MAX_WHATSAPP_TEXT_LENGTH,
  system: "Tu écris des relances WhatsApp humaines et courtes, découpées en segments \"generic\" ou \"factual\", fondées STRICTEMENT sur les messages réellement échangés (CONVERSATION EVIDENCE) pour tout segment factual. Le Contact et le Business Context ne sont que des informations d'identité, jamais des preuves sur l'état ou l'intention du prospect. Réponds en français.",
};

const EMAIL_POLICY: ConversationChannelPolicy = {
  channel: "email",
  label: "e-mail",
  maxTextLength: MAX_EMAIL_TEXT_LENGTH,
  system: "Tu écris des e-mails commerciaux de suivi, humains et concis, découpés en segments \"generic\" ou \"factual\", fondés STRICTEMENT sur les messages réellement échangés (CONVERSATION EVIDENCE) pour tout segment factual. Le Contact et le Business Context ne sont que des informations d'identité, jamais des preuves sur l'état ou l'intention du prospect. N'écris ni objet ni signature — uniquement le corps du message. Réponds en français.",
};

const WHATSAPP_SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["generic", "factual"] },
    text: { type: "string" },
    // Only meaningful for kind="factual" — validated server-side against the
    // real evidence set either way (a "generic" segment citing an evidenceId
    // is itself a contradiction, rejected below).
    supportedByEvidenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["kind", "text", "supportedByEvidenceIds"],
  additionalProperties: false,
};

const WHATSAPP_ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    // Ordered — concatenated in this order (space-joined) to reconstruct the
    // final message text server-side. Nothing outside this array ever
    // becomes part of the sent text.
    segments: { type: "array", items: WHATSAPP_SEGMENT_SCHEMA },
    // The model's own signal that context was too thin to personalize
    // confidently. Never trusted as sufficient on its own (false=>skip
    // checks) NOR as the final word when true (uncertain=true always forces
    // fallback, regardless of what the other checks would have said) — see
    // isAcceptableWhatsAppGeneration.
    uncertain: { type: "boolean" },
  },
  required: ["segments", "uncertain"],
  additionalProperties: false,
};

// A small, fixed French stopword list — just enough to stop trivial common
// words (vous/avec/dans/chez/cette/notre/votre/avez/êtes...) from counting as
// "shared vocabulary" between a claim and an evidence. Deliberately not a
// general-purpose stopword library — this only needs to be conservative
// enough for the closed word-overlap check below, not linguistically
// complete.
const FRENCH_STOPWORDS = new Set([
  "avec", "dans", "chez", "cette", "notre", "votre", "avez", "etes", "vous", "nous",
  "mais", "donc", "pour", "sans", "comme", "plus", "bien", "tres", "cela", "sur",
  "leur", "leurs", "elle", "elles", "ils", "sont", "sera", "sont", "meme", "aussi",
]);

// Lowercased, accent-stripped, alnum-only tokens of length >= 4, minus a
// small stopword list — deliberately crude (no stemming, no lemmatization)
// so behavior stays fully deterministic and easy to reason about in tests.
function significantWords(text: string): Set<string> {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
  return new Set(normalized.split(/\s+/).filter((word) => word.length >= 4 && !FRENCH_STOPWORDS.has(word)));
}

// The claim<->evidence support check (docs C2 audit §D/§E) — intentionally
// NOT isGroundedText/isSupportedFactualClaim from the LinkedIn pipeline
// above: those are built around a closed set of fact *types*, which has no
// equivalent in free-form conversation text. This is instead a simple,
// conservative word-overlap heuristic: a claim is considered supported by an
// evidence only if they share at least 2 significant words (or all of the
// claim's significant words, if it has fewer than 2) — no embeddings, no
// fuzzy similarity, no second LLM call. A claim with fewer than 2 shared
// words with EVERY cited evidence is rejected — a false negative here costs
// nothing but a safe fallback (docs C2 audit: preferred over a false
// positive that would expose a hallucination).
const MIN_SHARED_SIGNIFICANT_WORDS = 2;

function hasLexicalSupport(claimText: string, evidenceText: string): boolean {
  const claimWords = significantWords(claimText);
  if (claimWords.size === 0) return false;
  const evidenceWords = significantWords(evidenceText);
  const shared = [...claimWords].filter((word) => evidenceWords.has(word));
  return shared.length >= Math.min(MIN_SHARED_SIGNIFICANT_WORDS, claimWords.size);
}

// A fixed, narrow category of claim about the PROSPECT's own state — the
// one category that can never be honestly supported by an outbound (our
// own) message alone, no matter how it's phrased (docs C2 audit §E/§correction
// point 6/7). Matches both a self-declared claim's own text (below) and a
// backstop scan of the whole generated text, independent of what the model
// chose to self-report as a claim — a model that simply omits a claim must
// not be a way around this check (same principle as LinkedIn's
// NEED_OR_PROBLEM_ASSERTION backstop, re-derived here for WhatsApp's
// evidence shape rather than forced from it).
const PROSPECT_STATE_ASSERTION = /\b(int[ée]ress[ée]e?s?|besoins?|priorit[ée]s?|d[ée]fis?|objections?|pr[ée]occupations?|difficult[ée]s?|devis|rendez-vous|rdv|budget|d[ée]cisions?|engag[ée]?e?s?|promis(?:e|es)?|attend(?:iez|ez|u|ait|ons)?|convenus?|accord[ée]?s?)\b/i;

// A "factual" segment must be evidence-backed exactly like the old
// per-claim check (unchanged reasoning): every cited evidenceId must be
// real, a prospect-state assertion needs at least one INBOUND citation
// (docs C2 audit §E, correction §7), and the segment's own words must
// lexically overlap the cited evidence.
function isAcceptableFactualSegment(segment: WhatsAppSegment, evidenceById: Map<string, WhatsAppEvidence>): boolean {
  if (segment.supportedByEvidenceIds.length === 0) return false; // an admitted-unsupported factual segment
  const cited: WhatsAppEvidence[] = [];
  for (const id of segment.supportedByEvidenceIds) {
    const evidence = evidenceById.get(id);
    if (!evidence) return false; // citing an evidenceId that doesn't exist — never trusted
    cited.push(evidence);
  }
  const eligible = PROSPECT_STATE_ASSERTION.test(segment.text) ? cited.filter((evidence) => evidence.direction === "inbound") : cited;
  if (eligible.length === 0) return false;
  return eligible.some((evidence) => hasLexicalSupport(segment.text, evidence.text));
}

// A "generic" segment claims to assert NOTHING about the prospect — so the
// server holds it to that claim instead of trusting the label: (1) it may
// not cite any evidence at all (a generic segment has nothing to prove; a
// citation is itself a contradiction), (2) it still must not match the
// closed PROSPECT_STATE_ASSERTION vocabulary (cheap, catches the easy
// mislabeling case), and (3) — the actual close of the gap this correction
// is for — it must not lexically resemble any real evidence message. A
// model that reformulates real evidence in different words and mislabels
// the result "generic" to dodge the evidence requirement will, in practice,
// still share real vocabulary with the evidence it paraphrased; that
// resemblance is exactly what this check is built to catch, and it doesn't
// depend on any fixed list of forbidden words the way (2) does.
function isAcceptableGenericSegment(segment: WhatsAppSegment, evidence: WhatsAppEvidence[]): boolean {
  if (segment.supportedByEvidenceIds.length > 0) return false;
  if (PROSPECT_STATE_ASSERTION.test(segment.text)) return false;
  return !evidence.some((item) => hasLexicalSupport(segment.text, item.text));
}

function isAcceptableSegment(segment: WhatsAppSegment, evidence: WhatsAppEvidence[], evidenceById: Map<string, WhatsAppEvidence>): boolean {
  if (!segment.text.trim()) return false; // no empty segments padding the reconstructed message
  return segment.kind === "factual" ? isAcceptableFactualSegment(segment, evidenceById) : isAcceptableGenericSegment(segment, evidence);
}

// The single acceptance gate (docs C2 audit §J/§correction) — a generation is
// used ONLY if every segment passes, and the text sent is reconstructed
// SERVER-SIDE from those validated segments, never the model's own
// free-form string: there is no text span left unaccounted for by either
// isAcceptableFactualSegment or isAcceptableGenericSegment. `uncertain` is
// checked first and unconditionally: true always forces fallback regardless
// of what follows, and false never skips the checks below — the model is
// never its own final judge either way.
function isAcceptableWhatsAppGeneration(output: WhatsAppGenerationOutput, evidence: WhatsAppEvidence[], maxTextLength: number = MAX_WHATSAPP_TEXT_LENGTH): { ok: true; text: string } | { ok: false } {
  if (output.uncertain) return { ok: false };
  if (!output.segments.length) return { ok: false };
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  if (!output.segments.every((segment) => isAcceptableSegment(segment, evidence, evidenceById))) return { ok: false };
  const text = output.segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  if (!text) return { ok: false };
  if (text.length > maxTextLength) return { ok: false }; // rejected outright — never truncated (docs C2 correction §2)
  return { ok: true, text };
}

function buildWhatsAppEvidenceBlock(evidence: WhatsAppEvidence[]): string {
  if (!evidence.length) return "(aucun message exploitable)";
  return evidence.map((item) => `- [${item.evidenceId}] ${item.direction === "inbound" ? "Le prospect a écrit" : "Vous avez écrit"} : "${item.text}"`).join("\n");
}

// follow_up vs reactivation is a TONE policy, never a fact (docs C2 audit
// §F/§correction) — neither branch may assert that a specific action is
// pending, nor invent a reason for silence; only daysSinceLastMessage (a
// real, observed number from C1) may inform the reactivation tone.
function buildWhatsAppObjectivePolicy(objective: CampaignObjective, daysSinceLastMessage: number | null): string {
  if (objective === "reactivation") {
    return `Réactivation : cette relation est devenue inactive${daysSinceLastMessage !== null ? ` (${daysSinceLastMessage} jour(s) depuis le dernier message)` : ""}. Reprends contact de façon douce, sans reproche, sans jamais supposer ou expliquer pourquoi le prospect n'a pas répondu — le silence n'est la preuve d'aucun sentiment ni d'aucune raison précise.`;
  }
  return `Suivi (follow_up) : continuité directe de la conversation. N'affirme JAMAIS qu'une action précise (devis, rendez-vous, décision, engagement) est en attente ou promise, sauf si un message du prospect (CONVERSATION EVIDENCE, direction "reçu du prospect") le prouve explicitement.`;
}

function buildWhatsAppPrompt(evidence: WhatsAppEvidence[], contact: WhatsAppContactFacts, businessContext: BusinessContextRecord | null, objective: CampaignObjective, daysSinceLastMessage: number | null, guidance?: string, policy: ConversationChannelPolicy = WHATSAPP_POLICY): string {
  return [
    `=== CONVERSATION EVIDENCE (seule source de vérité sur ce que le prospect a dit ou fait — chaque ligne porte son identifiant [eN]) ===\n${buildWhatsAppEvidenceBlock(evidence)}`,
    `=== CONTACT FACTS (identité connue — permet une salutation ou une référence à l'entreprise, ne prouve AUCUNE intention ni situation commerciale) ===\nPrénom : ${contact.firstName || contact.name}${contact.company ? `\nEntreprise : ${contact.company}` : ""}`,
    `=== BUSINESS FACTS (décrit VOTRE entreprise, l'expéditeur — ne prouve RIEN sur le prospect) ===\n${businessContext?.companyName ?? "inconnue"}${businessContext?.businessDescription ? ` — ${businessContext.businessDescription}` : ""}`,
    `=== CAMPAIGN OBJECTIVE / TONE POLICY (politique de ton uniquement — n'est JAMAIS une preuve) ===\n${buildWhatsAppObjectivePolicy(objective, daysSinceLastMessage)}`,
    guidance ? `Consigne du fondateur pour ce message : ${guidance}` : null,
    `INSTRUCTIONS :\nRédige une relance ${policy.label} courte et humaine, découpée en une liste ORDONNÉE de \`segments\` qui, mis bout à bout dans l'ordre, forment le message final — n'écris aucun texte en dehors de ces segments.\n\nChaque segment est soit :\n- "generic" : formulation relationnelle qui n'affirme RIEN de spécifique sur ce prospect ou cette conversation — salutation ("Bonjour Marc"), politesse ("j'espère que vous allez bien"), relance conversationnelle ("je me permets de revenir vers vous"), question ouverte générique ("est-ce toujours d'actualité ?"). Un segment "generic" ne cite AUCUN identifiant dans \`supportedByEvidenceIds\` (tableau vide) — s'il en cite un, ce n'est pas générique.\n- "factual" : affirmation NOUVELLE portant sur le prospect ou la conversation (intérêt, besoin, situation, engagement, objection, action attendue). \`supportedByEvidenceIds\` DOIT alors citer UNIQUEMENT les identifiants [eN] de CONVERSATION EVIDENCE qui la justifient réellement — jamais un identifiant inventé.\n\nUne information tirée de CONTACT FACTS ou BUSINESS FACTS (prénom, entreprise, ce que vous proposez) reste "generic" : ce n'est pas une preuve sur le prospect, juste une identité déjà connue.\n\nNe classe JAMAIS un segment "generic" s'il affirme réellement quelque chose de spécifique sur ce prospect — un tel segment sera rejeté, et le rejet d'un seul segment invalide tout le message. S'il n'y a aucune affirmation à faire, un seul segment "generic" (question ouverte ou relance conversationnelle) est le cas normal et attendu.\n\nLe message final (tous les segments concaténés) doit faire ${policy.maxTextLength} caractères maximum — sois concis dès la rédaction, un message trop long sera rejeté entièrement, jamais coupé.\n\nIndique \`uncertain: true\` si le contexte disponible est trop pauvre pour une relance vraiment pertinente — dans ce cas garde un contenu simple plutôt que de forcer une personnalisation qui dépasserait ce que tu sais réellement. Réponds en français.`,
  ].filter(Boolean).join("\n\n");
}

// The one AI call for one message step. Always returns a usable text —
// either a validated, grounded proposal or the same deterministic
// `fallbackText` the caller already computed from the Contact's own known
// fields — never a rejected/ungrounded text exposed as a valid proposition
// (docs C2 correction: "Le texte IA rejeté ne doit jamais être exposé comme
// proposition valide").
async function generateGroundedWhatsAppMessage(
  evidence: WhatsAppEvidence[],
  contact: WhatsAppContactFacts,
  businessContext: BusinessContextRecord | null,
  objective: CampaignObjective,
  daysSinceLastMessage: number | null,
  fallbackText: string,
  guidance?: string,
  policy: ConversationChannelPolicy = WHATSAPP_POLICY,
): Promise<{ text: string; generationMode: GenerationMode; aiModel: string | null }> {
  const provider = getAIProvider();
  if (!provider) return { text: fallbackText, generationMode: "deterministic_fallback", aiModel: null };

  try {
    const result = await provider.generateStructured<WhatsAppGenerationOutput>({
      system: policy.system,
      prompt: buildWhatsAppPrompt(evidence, contact, businessContext, objective, daysSinceLastMessage, guidance, policy),
      schemaName: "ConversationPersonalization",
      schema: WHATSAPP_ARTIFACT_SCHEMA,
      maxTokens: policy.maxTextLength > MAX_WHATSAPP_TEXT_LENGTH ? 1200 : 400,
    });
    const verdict = isAcceptableWhatsAppGeneration(result.data, evidence, policy.maxTextLength);
    if (!verdict.ok) return { text: fallbackText, generationMode: "deterministic_fallback", aiModel: null };
    return { text: verdict.text, generationMode: "ai_grounded", aiModel: result.model };
  } catch {
    return { text: fallbackText, generationMode: "deterministic_fallback", aiModel: null };
  }
}

export async function generateConversationParticipantPersonalization(context: WorkspaceContext, campaignId: string, participantId: string, policy: ConversationChannelPolicy): Promise<GenerateOutcome> {
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

  // Separate, minimal lookup — kept apart from the participant/contact
  // queries above so their existing SQL (and every test built around it)
  // stays untouched; objective is a tone-policy input only (docs C2 audit
  // §F), never merged into any fact-bearing query.
  const campaignRow = await database.query<{ objective: CampaignObjective }>(
    `select objective from campaigns where workspace_id=$1 and id=$2`,
    [context.workspaceId, campaignId],
  );
  const objective: CampaignObjective = campaignRow.rows[0]?.objective ?? "follow_up";

  const businessContext = await getActiveBusinessContext(context);
  // C1's canonical Context Builder — reused verbatim, workspace isolation
  // and canonical Conversation resolution already guaranteed there. Null
  // (no eligible Conversation) degrades to an empty evidence set below,
  // never an error.
  const conversationContext = await buildChannelConversationContext(context.workspaceId, participant.contact_id, policy.channel);
  const evidence = conversationContext ? buildWhatsAppEvidence(conversationContext.recentMessages) : [];
  const daysSinceLastMessage = conversationContext?.daysSinceLastMessage ?? null;
  // No AI call at all when there's no inbound message to ground on (docs C2
  // audit §Audit 13/K — never spend a provider call when the outcome is
  // knowable in advance): an outbound-only or empty evidence set can never
  // support a prospect-state claim, so the deterministic fallback is not
  // just safer here, it's guaranteed to be what validation would produce
  // anyway.
  const hasInboundEvidence = evidence.some((item) => item.direction === "inbound");

  const observedFacts: ObservedFact[] = [{ type: "name", value: contact.name, source: "contact" }];
  if (contact.company) observedFacts.push({ type: "company", value: contact.company, source: "contact" });
  for (const item of evidence) observedFacts.push({ type: item.direction === "inbound" ? "conversation_inbound" : "conversation_outbound", value: item.text, source: `${policy.channel}_conversation` });

  const existing = (await getParticipantPersonalization(context, campaignId, participantId)) ?? emptyPersonalization();
  let messages = existing.messages;
  let lastAiModel: string | null = existing.aiModel;
  for (const step of messageSteps.rows) {
    const current = messages.find((entry) => entry.stepId === step.id);
    if (current?.status === "approved") continue; // never silently overwrite an approved message (docs spec §9/§16)
    const fallbackText = step.message_template?.trim()
      ? substituteContactPlaceholders(step.message_template, contact).slice(0, 1000)
      : deterministicWhatsAppMessage(contact);
    const generated = hasInboundEvidence
      ? await generateGroundedWhatsAppMessage(evidence, contact, businessContext, objective, daysSinceLastMessage, fallbackText, step.message_template ?? undefined, policy)
      : { text: fallbackText, generationMode: "deterministic_fallback" as const, aiModel: null };
    if (generated.generationMode === "ai_grounded") lastAiModel = generated.aiModel;
    messages = mergeMessageArtifact(messages, step.id, generated.text, generated.generationMode);
  }

  const next: ParticipantPersonalization = {
    evidence: { observedFacts, qualificationContext: null, strategyContext: null, uncertainties: [] },
    outreachAngle: existing.outreachAngle,
    invitation: existing.invitation,
    messages,
    generatedAt: new Date().toISOString(),
    aiModel: lastAiModel,
  };
  const ok = await savePersonalization(context, campaignId, participantId, next);
  if (!ok) return { ok: false, reason: "NOT_ELIGIBLE" };
  return { ok: true, personalization: next };
}

// The two channels whose evidence is a real message history. Identical
// pipeline, identical validation, identical fallback discipline — only the
// register and the length budget differ (see ConversationChannelPolicy).
export async function generateWhatsAppParticipantPersonalization(context: WorkspaceContext, campaignId: string, participantId: string): Promise<GenerateOutcome> {
  return generateConversationParticipantPersonalization(context, campaignId, participantId, WHATSAPP_POLICY);
}

// Email participants are existing Contacts with a known address, exactly
// like WhatsApp participants — never rows in campaign_prospect_candidates
// (LinkedIn-search-specific). A first-touch participant simply has no
// conversation yet, so evidence is empty and the deterministic fallback (the
// step's own template, with the Contact's real fields substituted) is what
// gets proposed for human approval — never an AI claim about someone Talvia
// has never exchanged a word with.
export async function generateEmailParticipantPersonalization(context: WorkspaceContext, campaignId: string, participantId: string): Promise<GenerateOutcome> {
  return generateConversationParticipantPersonalization(context, campaignId, participantId, EMAIL_POLICY);
}

const GENERATION_CONCURRENCY = 3;

// Controlled concurrency, not a sequential cascade, not a distributed job
// system (docs spec §15) — small chunks of Promise.all over whichever
// participants still need a first proposal (or an explicit re-generation
// list).
export async function generatePersonalizationForCampaign(context: WorkspaceContext, campaignId: string, participantIds?: string[]): Promise<{ generated: number; failed: number }> {
  // Dispatched by the campaign's OWN channel, exactly like the per-participant
  // route — this used to call the LinkedIn generator unconditionally, which
  // meant batch generation could only ever succeed for LinkedIn.
  const campaignRow = await database.query<{ channel_type: CampaignChannel }>(
    `select channel_type from campaigns where workspace_id=$1 and id=$2`,
    [context.workspaceId, campaignId],
  );
  const channelType = campaignRow.rows[0]?.channel_type;
  const generateOne = channelType === "whatsapp"
    ? generateWhatsAppParticipantPersonalization
    : channelType === "email"
      ? generateEmailParticipantPersonalization
      : generateParticipantPersonalization;

  const targets = participantIds?.length
    ? participantIds
    : (await database.query<{ id: string }>(
        // "still needs a first proposal" differs by channel: LinkedIn has an
        // invitation artifact, the conversation channels do not — for them a
        // participant is pending exactly while `personalization` is null.
        channelType === "linkedin"
          ? `select p.id from campaign_participants p join campaigns c on c.id=p.campaign_id
             where c.workspace_id=$1 and c.id=$2 and (p.personalization is null or p.personalization->'invitation'->>'status'='not_generated')`
          : `select p.id from campaign_participants p join campaigns c on c.id=p.campaign_id
             where c.workspace_id=$1 and c.id=$2 and p.personalization is null`,
        [context.workspaceId, campaignId],
      )).rows.map((row) => row.id);

  let generated = 0;
  let failed = 0;
  for (let index = 0; index < targets.length; index += GENERATION_CONCURRENCY) {
    const chunk = targets.slice(index, index + GENERATION_CONCURRENCY);
    const results = await Promise.all(chunk.map((participantId) => generateOne(context, campaignId, participantId)));
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

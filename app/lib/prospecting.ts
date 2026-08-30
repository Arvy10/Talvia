import { database } from "./database";
import { recordActivity, dispatchCommittedActivity } from "./activities";
import { getActiveBusinessContext, type BusinessContextRecord } from "./business-context/business-context-service";
import { getAIProvider } from "./ai";
import { getCampaignStrategy } from "./campaigns";
import type { CampaignStrategy } from "./campaign-strategy";
import { getUnipileConfig, searchLinkedInPeople } from "./providers/unipile";
import { findOrCreateContact } from "./providers/unipile-adapter";
import type { WorkspaceContext } from "./workspace-context";

// LinkedIn prospect discovery and qualification: a validated Campaign
// Strategy (see app/lib/campaign-strategy.ts) drives the Unipile search,
// results are qualified against that same strategy, and a human approves
// the list before anything becomes a Contact. See docs/product/TALVIA.md
// §4/§9. Actually *sending* anything (invitations, follow-ups) is a
// separate concern — see app/lib/campaign-execution/linkedin-executor.ts.

const PROVIDER = "unipile";

export type CandidateQualification = {
  score: number;
  fit: "strong" | "moderate" | "weak" | "insufficient_data";
  reasons: string[];
  uncertainties: string[];
  // A hard signal, not a −15 among others (Phase 2B §5): a candidate that
  // actually matches an exclusionCriterion, verifiable with the data we
  // have, is never allowed to read as "strong"/"moderate" no matter how
  // well role/geography otherwise match.
  disqualified: boolean;
  disqualificationReasons: string[];
  model: string | null;
  qualifiedAt: string;
};

export type ProspectCandidate = {
  id: string;
  providerId: string;
  name: string;
  headline?: string;
  company?: string;
  location?: string;
  role?: string;
  profileUrl?: string;
  status: "suggested" | "approved" | "rejected";
  qualification?: CandidateQualification;
  // Set only once approved — the id campaign-personalization.ts's routes
  // key off. Not present on a merely-suggested candidate.
  participantId?: string;
};

type CandidateRow = { id: string; provider_id: string; name: string; headline: string | null; company: string | null; location: string | null; role: string | null; profile_url: string | null; status: ProspectCandidate["status"]; qualification: CandidateQualification | null; participant_id?: string | null };
function candidateFromRow(row: CandidateRow): ProspectCandidate {
  return {
    id: row.id, providerId: row.provider_id, name: row.name, headline: row.headline ?? undefined, company: row.company ?? undefined,
    location: row.location ?? undefined, role: row.role ?? undefined, profileUrl: row.profile_url ?? undefined, status: row.status,
    ...(row.qualification ? { qualification: row.qualification } : {}),
    ...(row.participant_id ? { participantId: row.participant_id } : {}),
  };
}

// Exported for reuse by app/lib/campaign-execution/linkedin-executor.ts,
// which needs the same connected-account lookup at send time.
export async function getLinkedInAccountId(workspaceId: string): Promise<string> {
  const result = await database.query<{ external_account_id: string }>(
    `select external_account_id from connections where workspace_id=$1 and provider=$2 and channel_type='linkedin' and status='connected' limit 1`,
    [workspaceId, PROVIDER],
  );
  const accountId = result.rows[0]?.external_account_id;
  if (!accountId) throw new Error("Aucun compte LinkedIn connecté.");
  return accountId;
}

// The Search Criteria half of "Campaign Strategy -> Search Criteria ->
// Unipile" (docs spec §7) — recomputed from the CURRENT strategy on every
// search, never frozen at generation time, so a human correction is
// reflected the very next search without needing to regenerate anything.
// strategy.geography is deliberately NOT included here — Unipile's LinkedIn
// search (UnipileSearchCriteria in providers/unipile.ts) has no location
// parameter, so there is nothing to forward it to. Geography only ever
// filters after the fact, in deterministicSignals() below.
function buildSearchKeywordsFromStrategy(strategy: CampaignStrategy, extraKeywords?: string): string {
  const parts = [
    ...strategy.targetRoles.slice(0, 3),
    ...strategy.industries.slice(0, 2),
    ...strategy.companyTypes.slice(0, 2),
  ];
  if (extraKeywords?.trim()) parts.push(extraKeywords.trim());
  return parts.filter(Boolean).join(" ").trim().slice(0, 200);
}

// --- Qualification: deterministic rules first, AI only where it adds real
// value (docs spec §14). Never calls AI to check what plain string
// comparison already answers. The backend — never the AI — decides `fit`
// and `disqualified` (Phase 2B §3/§5): the model may propose a score and
// write the reasons/uncertainties, but the final classification always goes
// through fitFromScore()/deterministicSignals() below.

type QualifiableFacts = { id: string; name: string; headline?: string; company?: string; location?: string; role?: string };
type Signals = { matches: string[]; concerns: string[]; missingData: string[]; disqualified: boolean; disqualificationReasons: string[] };

// The single, shared score->fit mapping (Phase 2B §3) — the only place
// these thresholds are decided. An AI-proposed score is always resolved
// through this same function, never trusted alongside an independently
// AI-proposed fit label.
function fitFromScore(score: number): CandidateQualification["fit"] {
  if (score >= 70) return "strong";
  if (score >= 45) return "moderate";
  return "weak";
}

// insufficient_data means "we don't have enough of THIS candidate's own
// data to check the criteria the strategy actually asks about" (Phase 2B
// §4) — not "the strategy happens to define no criteria." A disqualifying
// exclusion always wins over "insufficient": we know enough to say no.
function resolveFit(score: number, signals: Pick<Signals, "matches" | "concerns" | "disqualified">): CandidateQualification["fit"] {
  if (signals.disqualified) return "weak";
  if (signals.matches.length === 0 && signals.concerns.length === 0) return "insufficient_data";
  return fitFromScore(score);
}

function deterministicSignals(candidate: QualifiableFacts, strategy: CampaignStrategy): Signals {
  const matches: string[] = [];
  const concerns: string[] = [];
  const missingData: string[] = [];
  const roleHaystack = `${candidate.headline ?? ""} ${candidate.role ?? ""}`.trim().toLowerCase();

  if (strategy.targetRoles.length) {
    if (!roleHaystack) {
      missingData.push("Rôle/headline non renseigné par LinkedIn — impossible de vérifier la correspondance avec les rôles ciblés.");
    } else {
      const roleMatch = strategy.targetRoles.find((role) => role.trim() && roleHaystack.includes(role.toLowerCase()));
      if (roleMatch) matches.push(`Le rôle affiché correspond au rôle ciblé "${roleMatch}".`);
      else concerns.push("Le rôle affiché ne correspond pas clairement aux rôles ciblés.");
    }
  }

  if (strategy.geography.length) {
    if (!candidate.location) {
      missingData.push("Localisation non renseignée par LinkedIn — impossible de vérifier la correspondance géographique.");
    } else {
      const geoMatch = strategy.geography.find((geo) => geo.trim() && candidate.location!.toLowerCase().includes(geo.toLowerCase()));
      if (geoMatch) matches.push(`Localisation dans la zone ciblée (${geoMatch}).`);
      else concerns.push("Localisation en dehors des zones ciblées.");
    }
  }

  const disqualificationReasons: string[] = [];
  if (strategy.exclusionCriteria.length) {
    for (const rule of strategy.exclusionCriteria) {
      if (rule.trim() && (roleHaystack.includes(rule.toLowerCase()) || (candidate.company ?? "").toLowerCase().includes(rule.toLowerCase()))) {
        disqualificationReasons.push(`Correspond à un critère d'exclusion : "${rule}".`);
      }
    }
  }

  return { matches, concerns, missingData, disqualified: disqualificationReasons.length > 0, disqualificationReasons };
}

function deterministicQualification(candidate: QualifiableFacts, strategy: CampaignStrategy, now: string): CandidateQualification {
  const signals = deterministicSignals(candidate, strategy);
  const score = Math.max(0, Math.min(100, 50 + signals.matches.length * 15 - signals.concerns.length * 15));
  const fit = resolveFit(score, signals);
  const uncertainties = fit === "insufficient_data" && signals.missingData.length === 0
    ? ["La stratégie ne définit ni rôle ni géographie à vérifier pour ce candidat."]
    : [...signals.concerns, ...signals.missingData];
  return { score, fit, reasons: signals.matches, uncertainties, disqualified: signals.disqualified, disqualificationReasons: signals.disqualificationReasons, model: null, qualifiedAt: now };
}

const QUALIFICATION_SCHEMA = {
  type: "object",
  properties: {
    qualifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          candidateId: { type: "string" },
          score: { type: "number" },
          reasons: { type: "array", items: { type: "string" } },
          uncertainties: { type: "array", items: { type: "string" } },
        },
        // Deliberately no `fit` field requested from the model — the
        // backend is authoritative on fit (Phase 2B §3), computed from
        // `score` via fitFromScore()/resolveFit(), never taken from the AI.
        required: ["candidateId", "score", "reasons", "uncertainties"],
        additionalProperties: false,
      },
    },
  },
  required: ["qualifications"],
  additionalProperties: false,
};

function buildQualificationPrompt(businessContext: BusinessContextRecord | null, strategy: CampaignStrategy, entries: Array<{ candidate: QualifiableFacts; signals: Signals }>): string {
  const context = [
    `Entreprise : ${businessContext?.companyName ?? "inconnue"}.`,
    `Cible de la campagne : ${strategy.targetDescription || strategy.objective}.`,
    `Rôles recherchés : ${strategy.targetRoles.join(", ") || "non précisé"}.`,
    `Secteurs ciblés : ${strategy.industries.join(", ") || "non précisé"}.`,
    `Géographie ciblée : ${strategy.geography.join(", ") || "non précisée"}.`,
    `Critères de qualification : ${strategy.qualificationCriteria.join(", ") || "aucun"}.`,
    `Critères d'exclusion : ${strategy.exclusionCriteria.join(", ") || "aucun"}.`,
  ].join(" ");
  const profiles = entries.map(({ candidate, signals }) =>
    `- id: ${candidate.id}\n  nom: ${candidate.name}\n  headline: ${candidate.headline ?? "inconnu"}\n  rôle: ${candidate.role ?? "inconnu"}\n  entreprise: ${candidate.company ?? "inconnue"}\n  localisation: ${candidate.location ?? "inconnue"}\n  signaux déterministes positifs: ${signals.matches.join("; ") || "aucun"}\n  signaux déterministes négatifs: ${signals.concerns.join("; ") || "aucun"}\n  données manquantes: ${signals.missingData.join("; ") || "aucune"}`,
  ).join("\n\n");
  return `${context}\n\nProfils à qualifier :\n\n${profiles}\n\nPour chaque id, donne un score 0-100 et des raisons/incertitudes concrètes fondées sur les données ci-dessus (le classement final strong/moderate/weak est calculé par le système, pas par toi). N'invente aucune information absente des profils.`;
}

// One batched AI call for the whole set of newly-found candidates — never
// one call per profile (docs spec §13). Deterministic signals are computed
// first and handed to the model as context, not re-derived by it, and are
// also what decides `fit`/`disqualified` for every candidate below —
// including those the AI did qualify — never the model's own judgment.
async function qualifyCandidates(businessContext: BusinessContextRecord | null, strategy: CampaignStrategy, candidates: QualifiableFacts[]): Promise<Map<string, CandidateQualification>> {
  const now = new Date().toISOString();
  const results = new Map<string, CandidateQualification>();
  if (candidates.length === 0) return results;

  const entries = candidates.map((candidate) => ({ candidate, signals: deterministicSignals(candidate, strategy) }));
  const signalsById = new Map(entries.map((entry) => [entry.candidate.id, entry.signals]));
  const provider = getAIProvider();
  if (!provider) {
    for (const candidate of candidates) results.set(candidate.id, deterministicQualification(candidate, strategy, now));
    return results;
  }

  try {
    const result = await provider.generateStructured<{ qualifications: Array<{ candidateId: string; score: number; reasons: string[]; uncertainties: string[] }> }>({
      system: "Tu qualifies des prospects LinkedIn par rapport à une stratégie de ciblage. Utilise UNIQUEMENT les données fournies pour chaque profil et les signaux déterministes déjà calculés. N'invente jamais une information absente (taille d'entreprise, activité récente, site web, etc.) — si une dimension est inconnue, mentionne-le explicitement dans 'uncertainties' plutôt que de l'affirmer. Réponds en français.",
      prompt: buildQualificationPrompt(businessContext, strategy, entries),
      schemaName: "CandidateQualifications",
      schema: QUALIFICATION_SCHEMA,
      maxTokens: 1800,
    });
    for (const item of result.data.qualifications) {
      const signals = signalsById.get(item.candidateId);
      if (!signals) continue; // the model referenced an id we never sent it — ignore, never fabricate a candidate
      const score = Math.max(0, Math.min(100, item.score));
      results.set(item.candidateId, {
        score,
        fit: resolveFit(score, signals),
        reasons: item.reasons,
        uncertainties: item.uncertainties,
        disqualified: signals.disqualified,
        disqualificationReasons: signals.disqualificationReasons,
        model: result.model,
        qualifiedAt: now,
      });
    }
  } catch {
    // A provider hiccup must never block search results from being
    // returned — fall back to the deterministic signals for everyone.
  }

  // Never fabricate a qualification the model didn't actually return —
  // anyone missing (never called, or dropped by a partial AI response)
  // gets the deterministic-only result instead.
  for (const candidate of candidates) {
    if (!results.has(candidate.id)) results.set(candidate.id, deterministicQualification(candidate, strategy, now));
  }
  return results;
}

async function persistQualifications(workspaceId: string, campaignId: string, qualifications: Map<string, ProspectCandidate & { qualification: CandidateQualification }>): Promise<void> {
  for (const candidate of qualifications.values()) {
    await database.query(`update campaign_prospect_candidates set qualification=$1 where workspace_id=$2 and campaign_id=$3 and id=$4`, [JSON.stringify(candidate.qualification), workspaceId, campaignId, candidate.id]);
  }
}

// Searches LinkedIn via Unipile from this campaign's validated Strategy
// (plus optional free-text refinement) and stores results as review
// candidates, qualified against that same strategy — nothing here creates a
// Contact or sends anything.
export async function searchProspects(context: WorkspaceContext, campaignId: string, extraKeywords?: string): Promise<ProspectCandidate[]> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");
  const accountId = await getLinkedInAccountId(context.workspaceId);
  const strategy = await getCampaignStrategy(context, campaignId);
  if (!strategy) throw new Error("Générez d'abord une stratégie de ciblage pour cette campagne.");
  // Server-side enforcement, deliberately not left to the UI (Phase 2B §1):
  // AI generates -> user reviews/corrects -> user explicitly validates ->
  // search allowed. Any edit or regeneration resets validatedAt to null
  // (see applyStrategyEdit/preserveManualStrategyFields in
  // campaign-strategy.ts) — an unvalidated strategy is never usable here,
  // no matter how it got that way.
  if (!strategy.validatedAt) throw new Error("Validez la stratégie de ciblage avant de lancer une recherche.");
  const keywords = buildSearchKeywordsFromStrategy(strategy, extraKeywords);
  if (!keywords) throw new Error("La stratégie ne contient aucun critère de recherche exploitable — complétez-la ou précisez des mots-clés.");

  const { items } = await searchLinkedInPeople(config, accountId, { keywords });

  const client = await database.connect();
  let stored: ProspectCandidate[];
  try {
    await client.query("begin");
    stored = [];
    for (const item of items) {
      const row = await client.query<CandidateRow>(
        `insert into campaign_prospect_candidates(workspace_id,campaign_id,provider_id,profile_url,name,headline,company,location,role)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict(campaign_id,provider_id) do update set name=excluded.name,headline=excluded.headline,company=excluded.company,location=excluded.location,role=excluded.role
         returning id,provider_id,name,headline,company,location,role,profile_url,status,qualification`,
        [context.workspaceId, campaignId, item.id, item.profile_url ?? null, item.name, item.headline ?? null, item.current_positions?.[0]?.company ?? null, item.location ?? null, item.current_positions?.[0]?.role ?? null],
      );
      stored.push(candidateFromRow(row.rows[0]!));
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  if (stored.length === 0) return stored;

  const businessContext = await getActiveBusinessContext(context);
  const qualifications = await qualifyCandidates(businessContext, strategy, stored);
  const withQualification = new Map(stored.map((candidate) => [candidate.id, { ...candidate, qualification: qualifications.get(candidate.id)! }]));
  await persistQualifications(context.workspaceId, campaignId, withQualification);
  return stored.map((candidate) => ({ ...candidate, qualification: qualifications.get(candidate.id) }));
}

export async function listCandidates(context: WorkspaceContext, campaignId: string): Promise<ProspectCandidate[]> {
  const result = await database.query<CandidateRow>(
    `select cd.id,cd.provider_id,cd.name,cd.headline,cd.company,cd.location,cd.role,cd.profile_url,cd.status,cd.qualification,p.id participant_id
     from campaign_prospect_candidates cd
     left join campaign_participants p on p.campaign_id=cd.campaign_id and p.contact_id=cd.contact_id
     where cd.workspace_id=$1 and cd.campaign_id=$2 order by cd.created_at desc`,
    [context.workspaceId, campaignId],
  );
  return result.rows.map(candidateFromRow);
}

// The human-review gate: only candidates explicitly approved here ever
// become a real Contact or get an invitation sent. Reuses
// findOrCreateContact — the exact same dedup-by-contact_identities logic
// the LinkedIn webhook/backfill paths already use, so a prospect who's
// already a Contact (or replies elsewhere first) is never duplicated.
export async function approveProspects(context: WorkspaceContext, campaignId: string, candidateIds: string[]): Promise<{ approved: number }> {
  const client = await database.connect();
  try {
    await client.query("begin");
    // A campaign already active when a prospect is approved never goes
    // through transitionCampaign's waiting->active flip again — without
    // this, the participant would sit in 'waiting' forever and the engine
    // (which only claims 'active' participants) would never see it. Same
    // convention as addParticipants in campaigns.ts.
    const campaignRow = await client.query<{ status: string }>(`select status from campaigns where workspace_id=$1 and id=$2`, [context.workspaceId, campaignId]);
    const participantStatus = campaignRow.rows[0]?.status === "active" ? "active" : "waiting";
    let approved = 0;
    for (const candidateId of [...new Set(candidateIds)]) {
      const candidate = await client.query<CandidateRow>(
        `select id,provider_id,name,headline,company,location,role,profile_url,status,qualification from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and id=$3`,
        [context.workspaceId, campaignId, candidateId],
      );
      const row = candidate.rows[0];
      if (!row || row.status === "approved") continue;

      const contactId = await findOrCreateContact(client, context.workspaceId, "linkedin", row.provider_id, row.profile_url ?? undefined, row.name, undefined, row.headline ?? undefined);
      // Prospecting-sourced contacts start as leads — but a contact already
      // further along the relationship (qualified, client, ...) never gets
      // reset just because they turned up in a search.
      await client.query(`update contacts set status='lead' where id=$1 and status='new'`, [contactId]);

      await client.query(`update campaign_prospect_candidates set status='approved',contact_id=$1 where id=$2`, [contactId, candidateId]);
      await client.query(
        `insert into campaign_participants(campaign_id,contact_id,status) values($1,$2,$3) on conflict(campaign_id,contact_id) do nothing`,
        [campaignId, contactId, participantStatus],
      );
      approved += 1;
    }
    // Point every newly-added participant at this campaign's first step
    // (the 'invite' step — the executor only claims participants already
    // sitting on it).
    await client.query(
      `update campaign_participants set current_step_id=(select id from campaign_steps where campaign_id=$1 order by position limit 1)
       where campaign_id=$1 and current_step_id is null`,
      [campaignId],
    );
    const activity = await recordActivity(context, { eventType: "campaign.prospects_approved", entityType: "campaign", entityId: campaignId, metadata: { campaignId, count: approved } }, client);
    await client.query("commit");
    await dispatchCommittedActivity(activity);
    return { approved };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

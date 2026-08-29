import { database } from "./database";
import { recordActivity, recordSystemActivity, dispatchCommittedActivity } from "./activities";
import { getActiveBusinessContext, type BusinessContextRecord } from "./business-context/business-context-service";
import { getAIProvider } from "./ai";
import { getUnipileConfig, searchLinkedInPeople, sendLinkedInInvitation } from "./providers/unipile";
import { findOrCreateContact } from "./providers/unipile-adapter";
import type { WorkspaceContext } from "./workspace-context";

// Supervised LinkedIn prospecting: search Business-Context-matched
// candidates, a human approves the list, invitations go out in manually-
// triggered batches at a safe pace. See docs/product/TALVIA.md §4/§9 and the
// plan this was built from for why this is deliberately not autonomous.

const PROVIDER = "unipile";

export type ProspectCandidate = {
  id: string;
  providerId: string;
  name: string;
  headline?: string;
  company?: string;
  profileUrl?: string;
  status: "suggested" | "approved" | "rejected";
};

type CandidateRow = { id: string; provider_id: string; name: string; headline: string | null; company: string | null; profile_url: string | null; status: ProspectCandidate["status"] };
function candidateFromRow(row: CandidateRow): ProspectCandidate {
  return { id: row.id, providerId: row.provider_id, name: row.name, headline: row.headline ?? undefined, company: row.company ?? undefined, profileUrl: row.profile_url ?? undefined, status: row.status };
}

async function getLinkedInAccountId(workspaceId: string): Promise<string> {
  const result = await database.query<{ external_account_id: string }>(
    `select external_account_id from connections where workspace_id=$1 and provider=$2 and channel_type='linkedin' and status='connected' limit 1`,
    [workspaceId, PROVIDER],
  );
  const accountId = result.rows[0]?.external_account_id;
  if (!accountId) throw new Error("Aucun compte LinkedIn connecté.");
  return accountId;
}

// Business Context's target fields are free-text tags (provenance-tracked),
// not LinkedIn's numeric parameter IDs — rather than resolving those IDs (a
// real Unipile lookup step, deferred past V1), this builds a plain keyword
// string, which LinkedIn Classic search accepts directly.
function buildSearchKeywords(businessContext: BusinessContextRecord | null, extraKeywords?: string): string {
  const parts = [
    ...(businessContext?.targetRoles?.value ?? []).slice(0, 3),
    ...(businessContext?.targetIndustries?.value ?? []).slice(0, 2),
    ...(businessContext?.targetCustomers?.value ?? []).slice(0, 2),
  ];
  if (extraKeywords?.trim()) parts.push(extraKeywords.trim());
  return parts.filter(Boolean).join(" ").trim().slice(0, 200);
}

// AI-personalized, 300-character-capped (LinkedIn's own hard limit) —
// falls back to a plain templated note if no AI provider is configured or
// the call fails, so a missing API key never blocks prospecting entirely.
async function buildInviteNote(businessContext: BusinessContextRecord | null, candidate: { name: string; headline?: string }): Promise<string> {
  const firstName = candidate.name.split(/\s+/)[0] || candidate.name;
  const fallback = businessContext?.companyName
    ? `Bonjour ${firstName}, je travaille chez ${businessContext.companyName} et votre profil m'intéresse. Ravi d'échanger !`
    : `Bonjour ${firstName}, votre profil m'intéresse, ravi d'échanger avec vous !`;

  const provider = getAIProvider();
  if (!provider) return fallback.slice(0, 300);

  try {
    const result = await provider.generateStructured<{ note: string }>({
      system: "Tu écris une note d'invitation LinkedIn courte, chaleureuse et professionnelle en français, jamais insistante ni commerciale de façon agressive. 300 caractères maximum, pas d'emoji.",
      prompt: `Entreprise qui invite : ${businessContext?.companyName ?? "une entreprise"}${businessContext?.businessDescription ? ` — ${businessContext.businessDescription}` : ""}.\nPersonne invitée : ${candidate.name}${candidate.headline ? `, ${candidate.headline}` : ""}.\nÉcris une note d'invitation personnalisée et brève.`,
      schemaName: "InviteNote",
      schema: { type: "object", properties: { note: { type: "string", maxLength: 300 } }, required: ["note"], additionalProperties: false },
      maxTokens: 200,
    });
    return (result.data.note || fallback).slice(0, 300);
  } catch {
    return fallback.slice(0, 300);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Searches LinkedIn via Unipile from the workspace's active Business
// Context (plus optional free-text refinement) and stores results as review
// candidates — nothing here creates a Contact or sends anything.
export async function searchProspects(context: WorkspaceContext, campaignId: string, extraKeywords?: string): Promise<ProspectCandidate[]> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");
  const accountId = await getLinkedInAccountId(context.workspaceId);
  const businessContext = await getActiveBusinessContext(context);
  const keywords = buildSearchKeywords(businessContext, extraKeywords);
  if (!keywords) throw new Error("Aucun critère de recherche : configurez votre Business Context ou précisez des mots-clés.");

  const { items } = await searchLinkedInPeople(config, accountId, { keywords });

  const client = await database.connect();
  try {
    await client.query("begin");
    const stored: ProspectCandidate[] = [];
    for (const item of items) {
      const row = await client.query<CandidateRow>(
        `insert into campaign_prospect_candidates(workspace_id,campaign_id,provider_id,profile_url,name,headline,company)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict(campaign_id,provider_id) do update set name=excluded.name,headline=excluded.headline,company=excluded.company
         returning id,provider_id,name,headline,company,profile_url,status`,
        [context.workspaceId, campaignId, item.id, item.profile_url ?? null, item.name, item.headline ?? null, item.current_positions?.[0]?.company ?? null],
      );
      stored.push(candidateFromRow(row.rows[0]!));
    }
    await client.query("commit");
    return stored;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listCandidates(context: WorkspaceContext, campaignId: string): Promise<ProspectCandidate[]> {
  const result = await database.query<CandidateRow>(
    `select id,provider_id,name,headline,company,profile_url,status from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 order by created_at desc`,
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
    let approved = 0;
    for (const candidateId of [...new Set(candidateIds)]) {
      const candidate = await client.query<CandidateRow>(
        `select id,provider_id,name,headline,company,profile_url,status from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and id=$3`,
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
        `insert into campaign_participants(campaign_id,contact_id,status) values($1,$2,'waiting') on conflict(campaign_id,contact_id) do nothing`,
        [campaignId, contactId],
      );
      approved += 1;
    }
    // Point every newly-added participant at this campaign's first step
    // (the 'invite' step — sendInviteBatch only claims participants already
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

const DEFAULT_BATCH_LIMIT = 15;
// Conservative even for a paid/active LinkedIn account (Unipile's own docs:
// ~80-100/day for paid, ~5/month for free) — Talvia defaults well under
// LinkedIn's own ceiling rather than pushing up against it. No settings UI
// for this in V1; revisit once real usage shows it's actually the
// bottleneck.
const MAX_BATCH_LIMIT = 25;

export type SendBatchResult = { sent: number; failed: number };

// One manually-triggered batch: claims up to `limit` waiting invites
// (SELECT...FOR UPDATE SKIP LOCKED, mirroring
// app/lib/acquisition/scheduler.ts's claim-then-send-outside-the-transaction
// pattern), sends each with a short randomized delay between calls — never
// a fixed interval, which is exactly the pattern LinkedIn's automation
// detection targets (Unipile's provider-limits docs).
// pacingMs is test-only (real callers never pass it) — production always
// uses the safe randomized 3-7s spacing; tests inject a near-zero range so
// the suite doesn't take real wall-clock minutes to send a batch.
export async function sendInviteBatch(context: WorkspaceContext, campaignId: string, limit = DEFAULT_BATCH_LIMIT, pacingMs: { min: number; spread: number } = { min: 3000, spread: 4000 }): Promise<SendBatchResult> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");
  const accountId = await getLinkedInAccountId(context.workspaceId);
  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_BATCH_LIMIT);

  const campaign = await database.query<{ status: string }>(`select status from campaigns where workspace_id=$1 and id=$2`, [context.workspaceId, campaignId]);
  if (!campaign.rows[0]) throw new Error("Campagne introuvable.");
  if (campaign.rows[0].status !== "active") throw new Error("La campagne doit être activée avant d'envoyer des invitations.");

  const inviteStep = await database.query<{ id: string }>(`select id from campaign_steps where campaign_id=$1 and step_type='invite' order by position limit 1`, [campaignId]);
  const step = inviteStep.rows[0];
  if (!step) throw new Error("Cette campagne n'a pas d'étape d'invitation.");

  const businessContext = await getActiveBusinessContext(context);

  const claimClient = await database.connect();
  let claimed: Array<{ id: string; contact_id: string }> = [];
  try {
    await claimClient.query("begin");
    const result = await claimClient.query<{ id: string; contact_id: string }>(
      `update campaign_participants set invite_claimed_at=now()
       where id in (
         select id from campaign_participants
         where campaign_id=$1 and status='active' and current_step_id=$2 and invite_sent_at is null
           and (invite_claimed_at is null or invite_claimed_at < now() - interval '10 minutes')
         order by created_at
         limit $3
         for update skip locked
       )
       returning id,contact_id`,
      [campaignId, step.id, cappedLimit],
    );
    claimed = result.rows;
    await claimClient.query("commit");
  } catch (error) {
    await claimClient.query("rollback");
    throw error;
  } finally {
    claimClient.release();
  }

  let sent = 0;
  let failed = 0;
  for (const participant of claimed) {
    try {
      const candidate = await database.query<{ provider_id: string; name: string; headline: string | null }>(
        `select provider_id,name,headline from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and contact_id=$3 and status='approved' limit 1`,
        [context.workspaceId, campaignId, participant.contact_id],
      );
      const info = candidate.rows[0];
      if (!info) throw new Error("Candidat introuvable pour ce participant.");

      const note = await buildInviteNote(businessContext, { name: info.name, headline: info.headline ?? undefined });
      await sendLinkedInInvitation(config, accountId, info.provider_id, note);

      await database.query(`update campaign_participants set invite_sent_at=now() where id=$1`, [participant.id]);
      sent += 1;
    } catch (error) {
      // Never fabricate success (docs/product/ARCHITECTURE.md §9) — leaving
      // invite_sent_at null and clearing the claim makes this participant
      // immediately eligible for the next manual batch, a safe retry.
      await database.query(`update campaign_participants set invite_claimed_at=null where id=$1`, [participant.id]);
      failed += 1;
      console.error(`[prospecting] invite failed for participant ${participant.id}`, error);
    }
    await sleep(pacingMs.min + Math.floor(Math.random() * pacingMs.spread));
  }

  const activity = await recordSystemActivity(context.workspaceId, { eventType: "campaign.invites_sent", entityType: "campaign", entityId: campaignId, metadata: { campaignId, sent, failed } });
  await dispatchCommittedActivity(activity);

  return { sent, failed };
}

import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import { getParticipantPersonalization } from "../campaign-personalization";
import { getUnipileConfig, sendLinkedInInvitation } from "../providers/unipile";
import { sendMessage } from "../providers/unipile-adapter";
import { getLinkedInAccountId } from "../prospecting";
import type { WorkspaceContext } from "../workspace-context";
import type { ReasonCode } from "./reason-codes";
import { advanceParticipantToNextStep, loadCampaignStep } from "./step-progression";
import type { ChannelExecutor, EngineRunSummary } from "./types";

// The LinkedIn implementation of ChannelExecutor. campaign_steps is the
// source of truth here (docs spec §2/§3): a participant's current_step_id is
// loaded, its step_type dispatches to the matching handler below, and only
// 'invite'/'message' are ever claimed — 'end' is terminal and never
// claimable (see step-progression.ts), 'wait'/'follow_up' aren't
// implemented yet but the dispatch shape already accommodates them without
// restructuring this file again.

const DEFAULT_BATCH_LIMIT = 15;
const MAX_BATCH_LIMIT = 25;
const DEFAULT_DAILY_LIMIT = 20;
const CLAIM_STALE_AFTER = "10 minutes";

// Talvia's own conservative ceiling (configurable — not a number invented as
// if it came from LinkedIn itself), and specifically about *invitations* —
// LinkedIn's real constraint is on connection requests, not messages to
// people who already accepted one, so this never throttles the message step.
function dailyInviteLimit(): number {
  const configured = Number(process.env.LINKEDIN_DAILY_INVITE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_DAILY_LIMIT;
}

async function recordParticipantError(participantId: string, code: ReasonCode): Promise<void> {
  await database.query(`update campaign_participants set last_error_code=$2,last_error_at=now() where id=$1`, [participantId, code]);
}

async function clearParticipantError(participantId: string): Promise<void> {
  await database.query(`update campaign_participants set last_error_code=null,last_error_at=null where id=$1`, [participantId]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blocked(blockedReason: ReasonCode): EngineRunSummary {
  return { attempted: 0, sent: 0, skipped: 0, failed: 0, blockedReason };
}

async function releaseClaim(participantId: string): Promise<void> {
  await database.query(`update campaign_participants set step_claimed_at=null where id=$1`, [participantId]);
}

type ClaimedParticipant = { id: string; contact_id: string; current_step_id: string };

async function claimByStepType(campaignId: string, stepType: "invite" | "message", limit: number): Promise<ClaimedParticipant[]> {
  if (limit <= 0) return [];
  const doneColumn = stepType === "invite" ? "invite_sent_at" : "message_sent_at";
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await client.query<ClaimedParticipant>(
      `update campaign_participants p set step_claimed_at=now()
       where p.id in (
         select p2.id from campaign_participants p2
         join campaign_steps s on s.id = p2.current_step_id
         where p2.campaign_id=$1 and p2.status='active' and s.step_type=$2
           and p2.${doneColumn} is null
           and (p2.step_claimed_at is null or p2.step_claimed_at < now() - interval '${CLAIM_STALE_AFTER}')
         order by p2.created_at
         limit $3
         for update skip locked
       )
       returning p.id,p.contact_id,p.current_step_id`,
      [campaignId, stepType, limit],
    );
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// The §7 re-check: fresh state, read again immediately before the network
// call — never trust what the claim query saw a moment ago. Catches a
// participant that replied (or was otherwise stopped) or whose step moved
// on, in the window between claim and send.
async function reverifyEligibility(context: WorkspaceContext, campaignId: string, participant: ClaimedParticipant): Promise<ReasonCode | null> {
  const campaign = await database.query<{ status: string }>(`select status from campaigns where workspace_id=$1 and id=$2`, [context.workspaceId, campaignId]);
  if (campaign.rows[0]?.status !== "active") return "CAMPAIGN_PAUSED";

  const fresh = await database.query<{ status: string; current_step_id: string | null }>(`select status,current_step_id from campaign_participants where id=$1`, [participant.id]);
  const row = fresh.rows[0];
  if (!row) return "NOT_ELIGIBLE";
  if (row.current_step_id !== participant.current_step_id) return "NOT_ELIGIBLE"; // the step moved on since claim
  if (row.status !== "active") return "PARTICIPANT_REPLIED";
  return null;
}

// Phase 4B §1: reverifyEligibility()'s read (above, in the claim loop) can
// already be stale by the time a message step actually reaches the provider
// — getParticipantPersonalization() and findLinkedInConversationId() are two
// more DB round-trips in between, either of which is enough time for a reply
// to land and commit. This is the narrower, later check: only participant
// existence/status/current_step_id, read again immediately before
// sendMessage() — not a replacement for reverifyEligibility (which also
// short-circuits on a paused campaign before any of this work happens), just
// the last word right before the provider call.
async function checkParticipantStillActive(participantId: string, expectedStepId: string): Promise<ReasonCode | null> {
  const fresh = await database.query<{ status: string; current_step_id: string | null }>(`select status,current_step_id from campaign_participants where id=$1`, [participantId]);
  const row = fresh.rows[0];
  if (!row) return "NOT_ELIGIBLE";
  if (row.current_step_id !== expectedStepId) return "NOT_ELIGIBLE";
  if (row.status !== "active") return "PARTICIPANT_REPLIED";
  return null;
}

async function findLinkedInConversationId(workspaceId: string, contactId: string): Promise<string | null> {
  const result = await database.query<{ id: string }>(
    `select id from conversations where workspace_id=$1 and contact_id=$2 and channel_type='linkedin' order by coalesce(last_message_at,created_at) desc limit 1`,
    [workspaceId, contactId],
  );
  return result.rows[0]?.id ?? null;
}

type StepOutcome = { result: "sent" | "failed"; reason?: ReasonCode };

// Phase 3: the executor never generates or substitutes text — it only ever
// sends the exact `approvedText` a human already reviewed and approved
// (docs spec §10/§13). No AI call happens here, at send time, ever.
async function executeInviteStep(context: WorkspaceContext, campaignId: string, participant: ClaimedParticipant, accountId: string, config: NonNullable<ReturnType<typeof getUnipileConfig>>): Promise<StepOutcome> {
  const candidate = await database.query<{ provider_id: string }>(
    `select provider_id from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and contact_id=$3 and status='approved' limit 1`,
    [context.workspaceId, campaignId, participant.contact_id],
  );
  const info = candidate.rows[0];
  if (!info) return { result: "failed", reason: "INVALID_IDENTITY" };

  const personalization = await getParticipantPersonalization(context, campaignId, participant.id);
  const approvedNote = personalization?.invitation.approvedText;
  if (!approvedNote) return { result: "failed", reason: "MESSAGE_NOT_APPROVED" };

  await sendLinkedInInvitation(config, accountId, info.provider_id, approvedNote);
  await database.query(`update campaign_participants set invite_sent_at=now(),step_claimed_at=null where id=$1`, [participant.id]);
  // The invite step does NOT advance current_step_id here — it stays on
  // 'invite', now waiting for the acceptance webhook (an external event,
  // not something this poll-driven claim can satisfy). See
  // unipile-adapter.ts for the advancement that follows acceptance.
  return { result: "sent" };
}

async function executeMessageStep(context: WorkspaceContext, campaignId: string, participant: ClaimedParticipant, step: NonNullable<Awaited<ReturnType<typeof loadCampaignStep>>>): Promise<StepOutcome> {
  const personalization = await getParticipantPersonalization(context, campaignId, participant.id);
  const approvedMessage = personalization?.messages.find((artifact) => artifact.stepId === step.id)?.approvedText;
  // No silent skip-past-this-step anymore (docs spec §12): a message step
  // with nothing approved is a real block, retry-eligible once a human
  // approves something — never a fabricated "sent".
  if (!approvedMessage) return { result: "failed", reason: "MESSAGE_NOT_APPROVED" };

  const conversationId = await findLinkedInConversationId(context.workspaceId, participant.contact_id);
  if (!conversationId) return { result: "failed", reason: "NOT_ELIGIBLE" };

  const finalIssue = await checkParticipantStillActive(participant.id, step.id);
  if (finalIssue) return { result: "failed", reason: finalIssue };

  await sendMessage(context.workspaceId, conversationId, approvedMessage);
  await database.query(`update campaign_participants set message_sent_at=now(),step_claimed_at=null where id=$1`, [participant.id]);

  const activity = await recordSystemActivity(context.workspaceId, { eventType: "campaign.message_sent", entityType: "campaign", entityId: campaignId, metadata: { campaignId, participantId: participant.id, contactId: participant.contact_id } });
  await dispatchCommittedActivity(activity);

  const advance = await advanceParticipantToNextStep(context.workspaceId, campaignId, participant.id, step.id);
  if (advance.activity) await dispatchCommittedActivity(advance.activity);
  return { result: "sent" };
}

// pacingMs is test-only (real callers never pass it) — production always
// uses the safe randomized 3-7s spacing between individual sends; tests
// inject a near-zero range so the suite doesn't take real wall-clock minutes.
export async function runDueLinkedInActions(
  context: WorkspaceContext,
  campaignId: string,
  limit = DEFAULT_BATCH_LIMIT,
  pacingMs: { min: number; spread: number } = { min: 3000, spread: 4000 },
): Promise<EngineRunSummary> {
  const config = getUnipileConfig();
  if (!config) return blocked("NO_LINKEDIN_CONNECTION");

  let accountId: string;
  try {
    accountId = await getLinkedInAccountId(context.workspaceId);
  } catch {
    return blocked("NO_LINKEDIN_CONNECTION");
  }

  const campaign = await database.query<{ status: string }>(`select status from campaigns where workspace_id=$1 and id=$2`, [context.workspaceId, campaignId]);
  if (!campaign.rows[0]) return blocked("NOT_ELIGIBLE");
  if (campaign.rows[0].status !== "active") return blocked("CAMPAIGN_PAUSED");

  const actionableSteps = await database.query<{ step_type: string }>(`select step_type from campaign_steps where campaign_id=$1 and step_type in ('invite','message')`, [campaignId]);
  if (actionableSteps.rows.length === 0) return blocked("NO_STEP_CONFIGURED");

  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_BATCH_LIMIT);

  const sentToday = await database.query<{ count: number }>(
    `select count(*)::int as count from campaign_participants p join campaigns c on c.id=p.campaign_id where c.workspace_id=$1 and p.invite_sent_at >= date_trunc('day', now())`,
    [context.workspaceId],
  );
  const remainingInviteBudget = Math.max(0, dailyInviteLimit() - Number(sentToday.rows[0]?.count ?? 0));

  // Two independent claims — invites are capped by the daily budget,
  // messages never are (LinkedIn's own limits are about connection
  // requests, not messages to people who already accepted one).
  const inviteClaims = await claimByStepType(campaignId, "invite", Math.min(cappedLimit, remainingInviteBudget));
  const messageClaims = await claimByStepType(campaignId, "message", Math.max(0, cappedLimit - inviteClaims.length));
  const claimed = [...inviteClaims.map((p) => ({ ...p, stepType: "invite" as const })), ...messageClaims.map((p) => ({ ...p, stepType: "message" as const }))];

  if (claimed.length === 0 && remainingInviteBudget <= 0) {
    // Only report the daily-limit block when there was genuinely nothing
    // else (e.g. no messages) to do either — a campaign that still has due
    // messages is not "blocked", it's just out of invite budget for today.
    const anyInviteEligible = await database.query<{ id: string }>(
      `select p.id from campaign_participants p join campaign_steps s on s.id=p.current_step_id where p.campaign_id=$1 and p.status='active' and s.step_type='invite' and p.invite_sent_at is null limit 1`,
      [campaignId],
    );
    if (anyInviteEligible.rows.length > 0) return blocked("DAILY_LIMIT_REACHED");
  }

  const stepCache = new Map<string, NonNullable<Awaited<ReturnType<typeof loadCampaignStep>>>>();

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let invitesSent = 0;
  let invitesFailed = 0;

  for (const participant of claimed) {
    const eligibilityIssue = await reverifyEligibility(context, campaignId, participant);
    if (eligibilityIssue) {
      await releaseClaim(participant.id);
      skipped += 1;
      continue; // no provider call made — no pacing needed
    }

    try {
      let step = stepCache.get(participant.current_step_id);
      if (!step) {
        const loaded = await loadCampaignStep(campaignId, participant.current_step_id);
        if (!loaded) throw new Error("Step introuvable pour ce participant.");
        step = loaded;
        stepCache.set(participant.current_step_id, step);
      }

      const outcome = step.step_type === "invite"
        ? await executeInviteStep(context, campaignId, participant, accountId, config)
        : await executeMessageStep(context, campaignId, participant, step);

      if (outcome.result === "sent") {
        await clearParticipantError(participant.id);
        sent += 1;
        if (participant.stepType === "invite") invitesSent += 1;
      } else {
        await releaseClaim(participant.id);
        await recordParticipantError(participant.id, outcome.reason ?? "PROVIDER_ERROR");
        failed += 1;
        if (participant.stepType === "invite") invitesFailed += 1;
      }
    } catch (error) {
      // Never fabricate success (docs/product/ARCHITECTURE.md §9) — release
      // the claim so this participant is retry-eligible on the next run.
      await releaseClaim(participant.id);
      const isRateLimit = error instanceof Error && /\(429\)/.test(error.message);
      await recordParticipantError(participant.id, isRateLimit ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR");
      failed += 1;
      if (participant.stepType === "invite") invitesFailed += 1;
      console.error(`[campaign-execution/linkedin] step execution failed for participant ${participant.id}`, error);
    }

    if (participant.stepType === "invite") await sleep(pacingMs.min + Math.floor(Math.random() * pacingMs.spread));
  }

  if (inviteClaims.length > 0) {
    const activity = await recordSystemActivity(context.workspaceId, { eventType: "campaign.invites_sent", entityType: "campaign", entityId: campaignId, metadata: { campaignId, sent: invitesSent, failed: invitesFailed } });
    await dispatchCommittedActivity(activity);
  }

  return { attempted: claimed.length, sent, skipped, failed };
}

export const linkedInExecutor: ChannelExecutor = {
  channel: "linkedin",
  async runDueActions(context, campaignId, opts) {
    return runDueLinkedInActions(context, campaignId, opts?.limit);
  },
};

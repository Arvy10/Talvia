import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import { getParticipantPersonalization } from "../campaign-personalization";
import { getUnipileConfig, sendLinkedInInvitation } from "../providers/unipile";
import { getLinkedInAccountId } from "../prospecting";
import type { WorkspaceContext } from "../workspace-context";
import { loadCampaignStep } from "./step-progression";
import type { ChannelExecutor, EngineRunSummary } from "./types";
import {
  blocked,
  claimByStepType,
  clearParticipantError,
  executeMessageStep,
  recordParticipantError,
  releaseClaim,
  reverifyEligibility,
  type ClaimedParticipant,
  type StepOutcome,
} from "./executor-shared";

// The LinkedIn implementation of ChannelExecutor. campaign_steps is the
// source of truth here (docs spec §2/§3): a participant's current_step_id is
// loaded, its step_type dispatches to the matching handler below, and only
// 'invite'/'message' are ever claimed — 'end' is terminal and never
// claimable (see step-progression.ts). Everything but the invite step itself
// (a LinkedIn-only concept — no other channel has a connection request or an
// acceptance wait) lives in executor-shared.ts, reused verbatim by
// whatsapp-executor.ts rather than duplicated.

const DEFAULT_BATCH_LIMIT = 15;
const MAX_BATCH_LIMIT = 25;
const DEFAULT_DAILY_LIMIT = 20;

// Talvia's own conservative ceiling (configurable — not a number invented as
// if it came from LinkedIn itself), and specifically about *invitations* —
// LinkedIn's real constraint is on connection requests, not messages to
// people who already accepted one, so this never throttles the message step.
function dailyInviteLimit(): number {
  const configured = Number(process.env.LINKEDIN_DAILY_INVITE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_DAILY_LIMIT;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        : await executeMessageStep(context, campaignId, participant, step, "linkedin");

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

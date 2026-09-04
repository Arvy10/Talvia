import { database } from "../database";
import { getUnipileConfig } from "../providers/unipile";
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
  type FirstTouchSender,
} from "./executor-shared";

// Email executor. Structurally identical to the WhatsApp one on purpose:
// claim, re-verify, WAIT (handled channel-agnostically by engine.ts before
// any executor runs), idempotence, reply-stop and workspace isolation are the
// SAME Campaign Engine machinery — this file only supplies what is genuinely
// email-specific (which connection must exist, and which channel to resolve
// the conversation on). There is no second engine and no email-specific
// participant state.
//
// Two delivery paths, one business action. A participant that already has a
// real email Conversation (historical import or inbound ingestion) gets a
// threaded reply through the shared executor. A participant whose address
// Talvia knows but who has no thread yet gets a FIRST TOUCH — the same
// approved text, the same idempotency key, the same participant state
// machine — through unipile-email.ts's sendFirstTouchEmail, which creates
// and later reconciles the real Conversation. Neither path exists outside
// executeMessageStep, so there is exactly one place that decides a
// participant may be contacted.

const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 50;

async function hasConnectedEmailAccount(workspaceId: string): Promise<boolean> {
  const result = await database.query<{ connected: boolean }>(
    `select exists(select 1 from connections where workspace_id=$1 and provider='unipile' and channel_type='email' and status='connected') as connected`,
    [workspaceId],
  );
  return Boolean(result.rows[0]?.connected);
}

async function loadCampaignEmailSubject(workspaceId: string, campaignId: string): Promise<string> {
  const result = await database.query<{ subject: string | null }>(
    `select settings->>'emailSubject' as subject from campaigns where workspace_id=$1 and id=$2`,
    [workspaceId, campaignId],
  );
  return result.rows[0]?.subject?.trim() ?? "";
}

export async function runDueEmailActions(context: WorkspaceContext, campaignId: string, limit = DEFAULT_BATCH_LIMIT): Promise<EngineRunSummary> {
  const config = getUnipileConfig();
  if (!config) return blocked("NO_EMAIL_CONNECTION");
  if (!(await hasConnectedEmailAccount(context.workspaceId))) return blocked("NO_EMAIL_CONNECTION");

  const campaign = await database.query<{ status: string }>(`select status from campaigns where workspace_id=$1 and id=$2`, [context.workspaceId, campaignId]);
  if (!campaign.rows[0]) return blocked("NOT_ELIGIBLE");
  if (campaign.rows[0].status !== "active") return blocked("CAMPAIGN_PAUSED");

  const actionableSteps = await database.query<{ step_type: string }>(`select step_type from campaign_steps where campaign_id=$1 and step_type='message'`, [campaignId]);
  if (actionableSteps.rows.length === 0) return blocked("NO_STEP_CONFIGURED");

  // A real subject, authored by the user when the campaign was created —
  // never derived from the body, never invented at send time. Only the
  // first-touch path needs it (a threaded reply keeps the thread's own
  // subject), so its absence blocks nothing until a participant genuinely
  // has no thread.
  const campaignSubject = await loadCampaignEmailSubject(context.workspaceId, campaignId);

  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_BATCH_LIMIT);
  const claimed = await claimByStepType(campaignId, "message", cappedLimit);

  const stepCache = new Map<string, NonNullable<Awaited<ReturnType<typeof loadCampaignStep>>>>();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const participant of claimed) {
    const eligibilityIssue = await reverifyEligibility(context, campaignId, participant);
    if (eligibilityIssue) {
      await releaseClaim(participant.id);
      skipped += 1;
      continue; // no provider call made
    }

    try {
      let step = stepCache.get(participant.current_step_id);
      if (!step) {
        const loaded = await loadCampaignStep(campaignId, participant.current_step_id);
        if (!loaded) throw new Error("Step introuvable pour ce participant.");
        step = loaded;
        stepCache.set(participant.current_step_id, step);
      }

      // Dynamic import for the same reason unipile-adapter.ts uses one for
      // the engine: unipile-email.ts imports the adapter's Contact and
      // Conversation helpers, so a static import from this file's own
      // import graph would close a cycle.
      const firstTouch: FirstTouchSender = async ({ participant: target, approvedText, idempotencyKey }) => {
        if (!campaignSubject) return { result: "failed", reason: "EMAIL_SUBJECT_MISSING" };
        const { sendFirstTouchEmail } = await import("../providers/unipile-email");
        const result = await sendFirstTouchEmail({ workspaceId: context.workspaceId, contactId: target.contact_id, subject: campaignSubject, body: approvedText, idempotencyKey });
        if (result.ok) return { result: "sent", ...(result.reason ? { reason: result.reason } : {}) };
        return { result: "failed", reason: result.reason, ...(result.reason === "EMAIL_SEND_OUTCOME_UNKNOWN" ? { retainClaim: true as const } : {}) };
      };

      const outcome = await executeMessageStep(context, campaignId, participant, step, "email", firstTouch);

      if (outcome.result === "sent") {
        // A "sent" outcome carrying a reason is a real send whose local
        // mirror is incomplete — recorded, not cleared, so it stays visible
        // (docs/product/ARCHITECTURE.md §9: never fabricate a clean result).
        if (outcome.reason) await recordParticipantError(participant.id, outcome.reason);
        else await clearParticipantError(participant.id);
        sent += 1;
      } else {
        // An unknown provider outcome keeps its claim: re-sending a mail a
        // real person may already have received is worse than waiting out
        // CLAIM_STALE_AFTER.
        if (!outcome.retainClaim) await releaseClaim(participant.id);
        await recordParticipantError(participant.id, outcome.reason ?? "PROVIDER_ERROR");
        failed += 1;
      }
    } catch (error) {
      // Never fabricate success (docs/product/ARCHITECTURE.md §9) — release
      // the claim so this participant is retry-eligible on the next run.
      await releaseClaim(participant.id);
      const isRateLimit = error instanceof Error && /\(429\)/.test(error.message);
      await recordParticipantError(participant.id, isRateLimit ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR");
      failed += 1;
      console.error(`[campaign-execution/email] step execution failed for participant ${participant.id}`, error);
    }
  }

  return { attempted: claimed.length, sent, skipped, failed };
}

export const emailExecutor: ChannelExecutor = {
  channel: "email",
  async runDueActions(context, campaignId, opts) {
    return runDueEmailActions(context, campaignId, opts?.limit);
  },
};

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
} from "./executor-shared";

// Email executor. Structurally identical to the WhatsApp one on purpose:
// claim, re-verify, WAIT (handled channel-agnostically by engine.ts before
// any executor runs), idempotence, reply-stop and workspace isolation are the
// SAME Campaign Engine machinery — this file only supplies what is genuinely
// email-specific (which connection must exist, and which channel to resolve
// the conversation on). There is no second engine and no email-specific
// participant state.
//
// Contract, deliberately narrower than the brief's eventual ambition: a
// participant must already have a real email Conversation (produced by the
// historical import or by inbound ingestion). First-touch outbound to a
// Contact whose address is known but who has no thread yet is a real and
// legitimate email capability, but it needs conversation bootstrapping plus
// reconciliation against the provider thread_id that only exists after the
// send — building that hastily is exactly how a thread ends up split across
// two Conversations. It is left as a designed, documented next step rather
// than half-implemented here.

const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 50;

async function hasConnectedEmailAccount(workspaceId: string): Promise<boolean> {
  const result = await database.query<{ connected: boolean }>(
    `select exists(select 1 from connections where workspace_id=$1 and provider='unipile' and channel_type='email' and status='connected') as connected`,
    [workspaceId],
  );
  return Boolean(result.rows[0]?.connected);
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

      const outcome = await executeMessageStep(context, campaignId, participant, step, "email");

      if (outcome.result === "sent") {
        await clearParticipantError(participant.id);
        sent += 1;
      } else {
        await releaseClaim(participant.id);
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

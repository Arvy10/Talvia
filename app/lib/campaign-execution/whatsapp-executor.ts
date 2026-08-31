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

// WhatsApp minimal executor: contacts/conversations already exist, there is
// no invite/acceptance concept, and a sequence starts directly on 'message'
// (docs "WhatsApp minimal" spec §1/§4). Everything reused here — claim,
// reverify, WAIT (via engine.ts's consumeDueWaitSteps, called before any
// executor runs), idempotence, reply-stop, workspace isolation — is the
// exact same Campaign Engine machinery LinkedIn uses, not a second engine.
// This file only ever claims 'message' steps.

const DEFAULT_BATCH_LIMIT = 15;
const MAX_BATCH_LIMIT = 25;

async function hasConnectedWhatsAppAccount(workspaceId: string): Promise<boolean> {
  const result = await database.query<{ connected: boolean }>(
    `select exists(select 1 from connections where workspace_id=$1 and provider='unipile' and channel_type='whatsapp' and status='connected') as connected`,
    [workspaceId],
  );
  return Boolean(result.rows[0]?.connected);
}

export async function runDueWhatsAppActions(context: WorkspaceContext, campaignId: string, limit = DEFAULT_BATCH_LIMIT): Promise<EngineRunSummary> {
  const config = getUnipileConfig();
  if (!config) return blocked("NO_WHATSAPP_CONNECTION");
  if (!(await hasConnectedWhatsAppAccount(context.workspaceId))) return blocked("NO_WHATSAPP_CONNECTION");

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

      const outcome = await executeMessageStep(context, campaignId, participant, step, "whatsapp");

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
      console.error(`[campaign-execution/whatsapp] step execution failed for participant ${participant.id}`, error);
    }
  }

  return { attempted: claimed.length, sent, skipped, failed };
}

export const whatsAppExecutor: ChannelExecutor = {
  channel: "whatsapp",
  async runDueActions(context, campaignId, opts) {
    return runDueWhatsAppActions(context, campaignId, opts?.limit);
  },
};

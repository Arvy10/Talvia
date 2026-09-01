import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import { getParticipantPersonalization } from "../campaign-personalization";
import { sendMessage } from "../providers/unipile-adapter";
import type { CampaignChannel } from "../campaigns";
import type { WorkspaceContext } from "../workspace-context";
import { findConversationId } from "./conversation-resolution";
import type { ReasonCode } from "./reason-codes";
import { advanceParticipantToNextStep, loadCampaignStep } from "./step-progression";
import type { EngineRunSummary } from "./types";

// The mechanisms every channel executor shares — claim/idempotence,
// eligibility re-checks, and message-step execution — extracted so a second
// channel never has to duplicate the Campaign Engine (LinkedIn's
// invite-specific logic stays in linkedin-executor.ts; everything here is
// genuinely channel-agnostic already). WhatsApp's own executor
// (whatsapp-executor.ts) reuses this file directly, not a copy of it.

export const CLAIM_STALE_AFTER = "10 minutes";

export function blocked(blockedReason: ReasonCode): EngineRunSummary {
  return { attempted: 0, sent: 0, skipped: 0, failed: 0, blockedReason };
}

export async function recordParticipantError(participantId: string, code: ReasonCode): Promise<void> {
  await database.query(`update campaign_participants set last_error_code=$2,last_error_at=now() where id=$1`, [participantId, code]);
}

export async function clearParticipantError(participantId: string): Promise<void> {
  await database.query(`update campaign_participants set last_error_code=null,last_error_at=null where id=$1`, [participantId]);
}

export async function releaseClaim(participantId: string): Promise<void> {
  await database.query(`update campaign_participants set step_claimed_at=null where id=$1`, [participantId]);
}

export type ClaimedParticipant = { id: string; contact_id: string; current_step_id: string };

export async function claimByStepType(campaignId: string, stepType: "invite" | "message", limit: number): Promise<ClaimedParticipant[]> {
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
export async function reverifyEligibility(context: WorkspaceContext, campaignId: string, participant: ClaimedParticipant): Promise<ReasonCode | null> {
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
// — getParticipantPersonalization() and findConversationId() are two more DB
// round-trips in between, either of which is enough time for a reply to land
// and commit. This is the narrower, later check: only participant
// existence/status/current_step_id, read again immediately before
// sendMessage() — not a replacement for reverifyEligibility (which also
// short-circuits on a paused campaign before any of this work happens), just
// the last word right before the provider call.
export async function checkParticipantStillActive(participantId: string, expectedStepId: string): Promise<ReasonCode | null> {
  const fresh = await database.query<{ status: string; current_step_id: string | null }>(`select status,current_step_id from campaign_participants where id=$1`, [participantId]);
  const row = fresh.rows[0];
  if (!row) return "NOT_ELIGIBLE";
  if (row.current_step_id !== expectedStepId) return "NOT_ELIGIBLE";
  if (row.status !== "active") return "PARTICIPANT_REPLIED";
  return null;
}

export type StepOutcome = { result: "sent" | "failed"; reason?: ReasonCode };

// Phase 3: the executor never generates or substitutes text — it only ever
// sends the exact `approvedText` a human already reviewed and approved
// (docs spec §10/§13). No AI call happens here, at send time, ever. Shared
// verbatim by every channel that only ever has 'message' steps (no
// invite/acceptance concept) — LinkedIn's own message step also runs through
// this, parameterized by channelType so conversation resolution can never
// cross channels for the same Contact.
export async function executeMessageStep(context: WorkspaceContext, campaignId: string, participant: ClaimedParticipant, step: NonNullable<Awaited<ReturnType<typeof loadCampaignStep>>>, channelType: CampaignChannel): Promise<StepOutcome> {
  const personalization = await getParticipantPersonalization(context, campaignId, participant.id);
  const approvedMessage = personalization?.messages.find((artifact) => artifact.stepId === step.id)?.approvedText;
  // No silent skip-past-this-step anymore (docs spec §12): a message step
  // with nothing approved is a real block, retry-eligible once a human
  // approves something — never a fabricated "sent".
  if (!approvedMessage) return { result: "failed", reason: "MESSAGE_NOT_APPROVED" };

  const conversationId = await findConversationId(context.workspaceId, participant.contact_id, channelType);
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

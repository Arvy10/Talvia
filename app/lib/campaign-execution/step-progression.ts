import type { PoolClient } from "pg";
import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity, type ActivityRecord } from "../activities";

// campaign_steps.position is the one source of truth for "what comes next"
// (docs spec §2). Both the LinkedIn executor (after a step it just executed
// succeeds) and the Unipile adapter (after an external event completes a
// step — e.g. invitation accepted) call this same function to move a
// participant forward. No provider/network calls happen here — this is
// purely domain-state progression, which is exactly why it can live below
// both prospecting.ts and linkedin-executor.ts without creating an import
// cycle (see unipile-adapter.ts's comment on why triggering the engine
// itself needs a dynamic import instead).

export type CampaignStepRow = { id: string; position: number; step_type: string; message_template: string | null };

export async function loadCampaignStep(campaignId: string, stepId: string): Promise<CampaignStepRow | null> {
  const result = await database.query<CampaignStepRow>(
    `select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and id=$2`,
    [campaignId, stepId],
  );
  return result.rows[0] ?? null;
}

async function nextStepAfter(campaignId: string, position: number): Promise<CampaignStepRow | null> {
  const result = await database.query<CampaignStepRow>(
    `select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and position>$2 order by position limit 1`,
    [campaignId, position],
  );
  return result.rows[0] ?? null;
}

export type AdvanceResult = {
  // "end": the next step is a terminal step_type='end' (or there is no next
  // step at all) — the participant is marked completed, in the same update,
  // and is never claimable again. "actionable": advanced onto a step the
  // engine can still act on (currently only 'message'). "none": fromStepId
  // didn't resolve to a real step for this campaign — a no-op.
  advancedTo: "end" | "actionable" | "none";
  stepId: string | null;
  stepType: string | null;
  // Recorded but never self-dispatched (same discipline as
  // recordActivity/recordSystemActivity) — the caller decides when it's
  // safe to dispatch, since that must never happen before an enclosing
  // transaction (if any) has committed.
  activity?: ActivityRecord;
};

// Pass `client` when called from inside an existing transaction (e.g. the
// same one that just recorded invite_accepted_at) so the state transition
// is atomic with the event that caused it — a crash between the two would
// otherwise leave a participant permanently stuck on invite_accepted_at set
// but current_step_id never advanced.
//
// fromStepId=null means "this participant hasn't executed any step yet" —
// used by initializeParticipantStep below to start a brand-new participant
// at the beginning of the sequence. There is no real step to look up a
// position from in that case, so fromPosition is simply -1: every real step
// has position>=0 (see the campaign_steps check constraint), so
// nextStepAfter(campaignId, -1) already resolves to position 0 with no
// special-casing needed — same query, same terminal/'end' handling, same
// current_step_id/last_action_at/step_claimed_at stamping as any other
// advance.
export async function advanceParticipantToNextStep(workspaceId: string, campaignId: string, participantId: string, fromStepId: string | null, client?: PoolClient): Promise<AdvanceResult> {
  const executor = client ?? database;
  let fromPosition = -1;
  if (fromStepId !== null) {
    const current = await executor.query<{ position: number }>(`select position from campaign_steps where campaign_id=$1 and id=$2`, [campaignId, fromStepId]);
    const position = current.rows[0]?.position;
    if (position === undefined) return { advancedTo: "none", stepId: null, stepType: null };
    fromPosition = position;
  }

  const next = await nextStepAfter(campaignId, fromPosition);
  if (!next || next.step_type === "end") {
    // last_action_at marks the moment the participant landed here — for a
    // WAIT step this is the anchor a later due-check computes from
    // (last_action_at + step.delay); stamping it unconditionally on every
    // transition (including this terminal one) keeps a single, uniform
    // "when did the current_step_id last change" invariant instead of a
    // second WAIT-specific timestamp column (see consumeDueWaitSteps below).
    await executor.query(
      `update campaign_participants set current_step_id=coalesce($1,current_step_id),status='completed',step_claimed_at=null,last_action_at=now(),updated_at=now() where id=$2`,
      [next?.id ?? null, participantId],
    );
    const activity = await recordSystemActivity(workspaceId, { eventType: "campaign.participant_completed", entityType: "campaign", entityId: campaignId, metadata: { campaignId, participantId } }, client);
    return { advancedTo: "end", stepId: next?.id ?? null, stepType: "end", activity };
  }

  await executor.query(`update campaign_participants set current_step_id=$1,step_claimed_at=null,last_action_at=now(),updated_at=now() where id=$2`, [next.id, participantId]);
  return { advancedTo: "actionable", stepId: next.id, stepType: next.step_type };
}

// A participant becoming genuinely ACTIVE in a sequential campaign
// (waiting->active at campaign activation/resume, or inserted directly as
// active by addParticipants on an already-active campaign) must land on a
// valid current_step_id pointing at the first step of the sequence — never
// stay active with current_step_id=NULL, which claimByStepType's own JOIN
// on campaign_steps can never match. This is a thin, explicitly-named alias
// over advanceParticipantToNextStep(..., null) — not a second SQL path: the
// exact same terminal/'end' handling, the exact same
// current_step_id/last_action_at/step_claimed_at stamping (last_action_at in
// particular is what lets a WAIT-first sequence become due later, via
// consumeDueWaitSteps below). Callers MUST only invoke this for a
// participant whose current_step_id is genuinely still null — calling it on
// one that has already progressed would silently do nothing useful for a
// real step (nextStepAfter would still resolve from position -1, i.e. the
// very first step again) — see campaigns.ts's `current_step_id is null`
// guard at both call sites for how that's enforced today.
export async function initializeParticipantStep(workspaceId: string, campaignId: string, participantId: string, client?: PoolClient): Promise<AdvanceResult> {
  return advanceParticipantToNextStep(workspaceId, campaignId, participantId, null, client);
}

// --- WAIT steps ---
// A WAIT is never a setTimeout/sleep — it is purely the combination of (a)
// last_action_at, stamped above the moment the participant landed on the
// WAIT step, and (b) that step's own delay_value/delay_unit (already a
// structured column on campaign_steps, not free text). "Due" is a computed
// predicate, not a second stored timestamp — this is the one-column-free
// path 016_campaign_step_execution.sql's own comment anticipated. A WAIT
// participant becomes claimable through the exact same step_claimed_at
// marker/SKIP LOCKED discipline as invite/message claims
// (linkedin-executor.ts's claimByStepType) — one idempotence mechanism, not
// a second one invented for this step type.
const WAIT_CLAIM_STALE_AFTER = "10 minutes";

async function claimDueWaitParticipants(campaignId: string, limit: number): Promise<Array<{ id: string; current_step_id: string }>> {
  if (limit <= 0) return [];
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: string; current_step_id: string }>(
      `update campaign_participants p set step_claimed_at=now()
       where p.id in (
         select p2.id from campaign_participants p2
         join campaign_steps s on s.id = p2.current_step_id
         where p2.campaign_id=$1 and p2.status='active' and s.step_type='wait'
           and p2.last_action_at is not null
           and p2.last_action_at + (s.delay_value || ' ' || s.delay_unit)::interval <= now()
           and (p2.step_claimed_at is null or p2.step_claimed_at < now() - interval '${WAIT_CLAIM_STALE_AFTER}')
         order by p2.created_at
         limit $2
         for update skip locked
       )
       returning p.id,p.current_step_id`,
      [campaignId, limit],
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

export type WaitConsumptionResult = { consumed: number };

// Called once per engine run, before the channel executor (see engine.ts) —
// channel-agnostic on purpose (docs spec §9: a WAIT is not a per-channel
// concept). A WAIT that has not elapsed is simply not claimed here: this is
// NOT an error path (docs spec §18) — nothing is recorded on
// last_error_code/last_error_at for an unclaimed, not-yet-due participant.
// Consuming a WAIT never calls a provider — only advanceParticipantToNextStep
// (pure domain-state progression) — so a paused campaign or a reply landing
// between claim and advance is exactly as safe to guard against as the
// message/invite claims: a fresh re-read right before acting, never trusting
// what the claim query saw a moment ago.
export async function consumeDueWaitSteps(workspaceId: string, campaignId: string, limit = 50): Promise<WaitConsumptionResult> {
  const campaign = await database.query<{ status: string }>(`select status from campaigns where workspace_id=$1 and id=$2`, [workspaceId, campaignId]);
  if (campaign.rows[0]?.status !== "active") return { consumed: 0 };

  const claimed = await claimDueWaitParticipants(campaignId, limit);
  const pendingActivities: ActivityRecord[] = [];
  let consumed = 0;

  for (const participant of claimed) {
    const fresh = await database.query<{ status: string; current_step_id: string | null }>(`select status,current_step_id from campaign_participants where id=$1`, [participant.id]);
    const row = fresh.rows[0];
    if (!row || row.status !== "active" || row.current_step_id !== participant.current_step_id) {
      // Replied, stopped, or moved on since the claim — release the claim
      // marker and do nothing. Never advance a participant that is no
      // longer legitimately waiting on this exact step.
      await database.query(`update campaign_participants set step_claimed_at=null where id=$1`, [participant.id]);
      continue;
    }
    try {
      const advance = await advanceParticipantToNextStep(workspaceId, campaignId, participant.id, participant.current_step_id);
      if (advance.activity) pendingActivities.push(advance.activity);
      consumed += 1;
    } catch (error) {
      // Never let one participant's failure block the rest of the batch —
      // same discipline as runDueLinkedInActions. Release the claim so this
      // participant is retry-eligible on the next run instead of stuck
      // behind a stale claim for WAIT_CLAIM_STALE_AFTER.
      await database.query(`update campaign_participants set step_claimed_at=null where id=$1`, [participant.id]);
      console.error(`[campaign-execution/step-progression] wait consumption failed for participant ${participant.id}`, error);
    }
  }

  for (const activity of pendingActivities) await dispatchCommittedActivity(activity);
  return { consumed };
}

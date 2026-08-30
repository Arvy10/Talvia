import { database } from "../database";
import type { CampaignChannel, CampaignObjective } from "../campaigns";
import type { WorkspaceContext } from "../workspace-context";
import { linkedInExecutor } from "./linkedin-executor";
import { consumeDueWaitSteps } from "./step-progression";
import type { ChannelExecutor, EngineRunSummary } from "./types";

// The one place that knows which executor handles which
// (channel, objective) pair (docs/product spec §2's "TALVIA CAMPAIGN DOMAIN
// → [LinkedIn | WhatsApp | Email] Executor" diagram). Adding a channel later
// means adding one entry here, not touching campaigns.ts, participants,
// scheduling, or workspace isolation.
const EXECUTORS: Array<{ channel: CampaignChannel; objective: CampaignObjective; executor: ChannelExecutor }> = [
  { channel: "linkedin", objective: "prospecting", executor: linkedInExecutor },
];

function pickExecutor(channel: CampaignChannel, objective: CampaignObjective): ChannelExecutor | null {
  return EXECUTORS.find((entry) => entry.channel === channel && entry.objective === objective)?.executor ?? null;
}

// Runs whatever is due for one campaign, right now. Called both by a human
// clicking "Envoyer ce lot" (scoped to their own workspace via
// getCurrentWorkspace()) and by the cron-triggered sweep below — same code
// path either way, so there is exactly one implementation of "what does it
// mean to execute a campaign's due actions", not a manual one and a
// scheduled one that can drift apart.
export async function runDueCampaignActions(context: WorkspaceContext, campaignId: string, opts?: { limit?: number }): Promise<EngineRunSummary> {
  const campaign = await database.query<{ channel_type: CampaignChannel; objective: CampaignObjective }>(
    `select channel_type,objective from campaigns where workspace_id=$1 and id=$2`,
    [context.workspaceId, campaignId],
  );
  const row = campaign.rows[0];
  if (!row) return { attempted: 0, sent: 0, skipped: 0, failed: 0, blockedReason: "NOT_ELIGIBLE" };

  // Channel-agnostic on purpose (docs spec §9): a participant sitting on a
  // WAIT step that has elapsed is advanced onto its next step BEFORE the
  // channel executor runs, so a message that just became executable is
  // picked up in this same call — no separate re-entrant pass needed, and
  // WhatsApp/Email get WAIT support for free once they register an executor.
  await consumeDueWaitSteps(context.workspaceId, campaignId);

  const executor = pickExecutor(row.channel_type, row.objective);
  // Not every (channel, objective) has an executor yet (WhatsApp/Email
  // are deliberately not built) — that is not a failure, just nothing this
  // engine currently automates for this campaign.
  if (!executor) return { attempted: 0, sent: 0, skipped: 0, failed: 0 };

  return executor.runDueActions(context, campaignId, opts);
}

export type EngineSweepResult = {
  campaignsProcessed: number;
  results: Array<{ workspaceId: string; campaignId: string; summary: EngineRunSummary }>;
};

// The cron/job entry point (see app/api/campaigns/engine/run/route.ts) —
// sweeps every workspace's active, automatable campaigns. Each campaign is
// still executed through the exact same workspace-scoped
// runDueCampaignActions() above; nothing here ever queries or mutates across
// a workspace_id boundary.
export async function runEngineSweep(): Promise<EngineSweepResult> {
  const rows = await database.query<{ id: string; workspace_id: string; created_by_user_id: string | null }>(
    `select c.id,c.workspace_id,c.created_by_user_id
     from campaigns c
     where c.status='active'
       and (c.channel_type,c.objective) in (${EXECUTORS.map((_, index) => `($${index * 2 + 1},$${index * 2 + 2})`).join(",")})`,
    EXECUTORS.flatMap((entry) => [entry.channel, entry.objective]),
  );

  const results: EngineSweepResult["results"] = [];
  for (const campaignRow of rows.rows) {
    const context: WorkspaceContext = {
      workspaceId: campaignRow.workspace_id,
      userId: campaignRow.created_by_user_id ?? "",
      authUserId: "campaign-engine",
      role: "owner",
    };
    const summary = await runDueCampaignActions(context, campaignRow.id);
    results.push({ workspaceId: campaignRow.workspace_id, campaignId: campaignRow.id, summary });
  }
  return { campaignsProcessed: rows.rows.length, results };
}

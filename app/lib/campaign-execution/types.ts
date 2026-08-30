import type { CampaignChannel } from "../campaigns";
import type { WorkspaceContext } from "../workspace-context";
import type { ReasonCode } from "./reason-codes";

// One channel's contribution to the shared execution model
// (docs/product/... spec: "Campaign → Participants → Steps → Execution
// State → [LinkedIn | WhatsApp | Email] Executor"). Only LinkedIn has a real
// implementation today — WhatsApp/Email are deliberately not built yet, but
// adding them later means writing one more file that satisfies this
// interface and registering it in engine.ts, not touching participants,
// scheduling, idempotency, or workspace isolation.
export type EngineRunSummary = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  // Set when a structural blocker prevented the executor from even
  // attempting anything this run (no connection, no invite step, etc.) —
  // distinct from a per-participant last_error_code, which explains one
  // participant rather than the whole run.
  blockedReason?: ReasonCode;
};

export interface ChannelExecutor {
  readonly channel: CampaignChannel;
  // Finds this campaign's currently-eligible participants and executes
  // whatever step is due for each of them. Must be safe to call repeatedly
  // (idempotent) — a participant already acted on is simply skipped, never
  // acted on twice.
  runDueActions(context: WorkspaceContext, campaignId: string, opts?: { limit?: number }): Promise<EngineRunSummary>;
}

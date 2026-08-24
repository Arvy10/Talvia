import { database } from "./database";
import type { PoolClient } from "pg";
import type { WorkspaceContext } from "./workspace-context";

export type ActivitySource = "user" | "automation" | "test";
export type ActivityInput = {
  eventType: string;
  entityType: "contact" | "opportunity" | "campaign" | "conversation";
  entityId: string;
  metadata?: Record<string, unknown>;
  source?: ActivitySource;
  automationRunId?: string;
};
export type ActivityRecord = ActivityInput & {
  id: string;
  workspaceId: string;
  actorUserId: string;
  createdAt: string;
};

export async function recordActivity(context: WorkspaceContext, input: ActivityInput, client?: PoolClient): Promise<ActivityRecord> {
  const executor = client ?? database;
  const result = await executor.query<{ id: string; created_at: string }>(
    `insert into activities(workspace_id, actor_type, actor_id, event_type, entity_type, entity_id, metadata, source, automation_run_id)
     values($1, 'user', $2, $3, $4, $5, $6, $7, $8) returning id, created_at`,
    [context.workspaceId, context.userId, input.eventType, input.entityType, input.entityId, input.metadata ?? {}, input.source ?? "user", input.automationRunId ?? null],
  );
  const row = result.rows[0]!;
  return {
    ...input,
    id: row.id,
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    createdAt: row.created_at,
  };
}

export async function processRecordedActivity(activity: ActivityRecord) {
  if (activity.source === "automation") return;
  try {
    const { processActivity } = await import("./automations");
    await processActivity(activity);
  } catch {
    // Automation errors must never undo the mutation that emitted the activity.
  }
}

// Call only after the caller's transaction committed successfully.
export const dispatchCommittedActivity = processRecordedActivity;

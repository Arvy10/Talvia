import { database } from "../database";
import type { CampaignChannel } from "../campaigns";

// The single canonical rule for "which Conversation represents a Contact's
// relationship on a given channel" for Campaigns — used by the executor at
// send time (executor-shared.ts's executeMessageStep) and by WhatsApp
// campaign audience selection (campaigns.ts's listEligibleWhatsAppRelations)
// at selection time. These must never diverge: showing one Conversation in
// the audience while the executor actually sends into a different one would
// silently break the product's core promise that a WhatsApp campaign
// continues a real, existing relationship. Deliberately kept dependency-free
// beyond ../database and this type — importing campaigns.ts's own runtime
// exports here (rather than just its CampaignChannel type) would create a
// real circular require: campaigns.ts -> campaign-execution/executor-shared.ts
// -> campaign-personalization.ts -> campaigns.ts.
//
// Deterministic even when multiple Conversations tie on their primary sort
// key: coalesce(last_message_at,created_at) can genuinely tie (e.g. two
// conversations backfilled in the same batch, neither with a message yet),
// so created_at is a real secondary key, and id is a final, always-unique
// tie-break — never left to whatever order Postgres happens to return.
export async function findConversationId(workspaceId: string, contactId: string, channelType: CampaignChannel): Promise<string | null> {
  const result = await database.query<{ id: string }>(
    `select id from conversations
     where workspace_id=$1 and contact_id=$2 and channel_type=$3
     order by coalesce(last_message_at,created_at) desc, created_at desc, id desc
     limit 1`,
    [workspaceId, contactId, channelType],
  );
  return result.rows[0]?.id ?? null;
}

import { NextResponse } from "next/server";

import { database } from "../../../../lib/database";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const context = await getCurrentWorkspace();
    const contactId = (await params).contactId;
    const owned = await database.query("select id from contacts where workspace_id=$1 and id=$2 and archived_at is null", [context.workspaceId, contactId]);
    if (!owned.rowCount) return NextResponse.json({ error: "Introuvable." }, { status: 404 });
    const [conversations, opportunities, campaigns] = await Promise.all([
      database.query("select c.id,c.channel_type channel,c.last_message_at from conversations c join conversation_participants p on p.conversation_id=c.id where c.workspace_id=$1 and p.contact_id=$2 and c.status <> 'archived' order by c.last_message_at desc", [context.workspaceId, contactId]),
      database.query("select id,name as title,stage from opportunities where workspace_id=$1 and contact_id=$2 order by created_at desc", [context.workspaceId, contactId]),
      database.query("select c.id,c.name,c.status,p.status participant_status from campaigns c join campaign_participants p on p.campaign_id=c.id where c.workspace_id=$1 and p.contact_id=$2 and c.archived_at is null order by c.created_at desc", [context.workspaceId, contactId]),
    ]);
    return NextResponse.json({ conversations: conversations.rows, opportunities: opportunities.rows, campaigns: campaigns.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." }, { status: error instanceof UnauthorizedError ? 401 : 400 });
  }
}

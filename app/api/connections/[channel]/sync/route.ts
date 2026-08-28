import { NextResponse } from "next/server";

import type { ChannelId } from "../../../../app/state/types";
import { database } from "../../../../lib/database";
import { backfillConnectionHistory } from "../../../../lib/providers/unipile-adapter";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";

export const runtime = "nodejs";

type Context = { params: Promise<{ channel: string }> };

function isChannelId(value: string): value is ChannelId {
  return value === "linkedin" || value === "whatsapp" || value === "gmail";
}

// One-time historical import for an already-connected channel. Manually
// triggered (a button in Connections, not auto-fired from the webhook) since
// a full LinkedIn history can take a while to page through and Unipile
// expects the webhook response itself to stay fast. Safe to call more than
// once — every insert is idempotent by provider_message_id.
export async function POST(_request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const { channel } = await params;
    if (!isChannelId(channel)) {
      return NextResponse.json({ error: "Canal inconnu." }, { status: 400 });
    }
    const connection = await database.query<{ id: string }>(
      `select id from connections where workspace_id=$1 and provider='unipile' and channel_type=$2 and status='connected'`,
      [context.workspaceId, channel],
    );
    if (!connection.rows[0]) {
      return NextResponse.json({ error: "Ce canal n'est pas connecté." }, { status: 400 });
    }
    const summary = await backfillConnectionHistory(connection.rows[0].id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof UnauthorizedError ? "Non authentifié." : error instanceof Error ? error.message : "Erreur serveur." },
      { status: error instanceof UnauthorizedError ? 401 : 400 },
    );
  }
}

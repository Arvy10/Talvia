import { NextResponse } from "next/server";

import { database } from "../../lib/database";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentWorkspace();
    const result = await database.query("select id,provider,channel_type,status,display_name,connected_at,last_synced_at from connections where workspace_id=$1 order by created_at", [context.workspaceId]);
    return NextResponse.json({ connections: result.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." }, { status: error instanceof UnauthorizedError ? 401 : 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getCurrentWorkspace();
    const input = await request.json() as { channel: "linkedin" | "whatsapp" | "email"; status: "disconnected" | "connecting" | "syncing" | "connected" | "error" };
    const provider = input.channel === "email" ? "gmail" : input.channel;
    const result = await database.query(
      `insert into connections(workspace_id,provider,channel_type,external_account_id,display_name,status,connected_at,last_synced_at)
       values($1,$2,$3,$4,$5,$6,case when $6='connected' then now() else null end,case when $6='connected' then now() else null end)
       on conflict(workspace_id,provider,external_account_id) do update set status=excluded.status,connected_at=case when excluded.status='connected' then now() else connections.connected_at end,last_synced_at=case when excluded.status='connected' then now() else connections.last_synced_at end
       returning id,provider,channel_type,status,display_name,connected_at,last_synced_at`,
      [context.workspaceId, provider, input.channel, `local:${context.workspaceId}:${provider}`, provider === "gmail" ? "Gmail" : provider === "linkedin" ? "LinkedIn" : "WhatsApp", input.status],
    );
    return NextResponse.json({ connection: result.rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." }, { status: error instanceof UnauthorizedError ? 401 : 400 });
  }
}

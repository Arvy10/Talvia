import { NextResponse } from "next/server";

import { requestConnectionSync } from "../../../../lib/providers/unipile-adapter";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";

export const runtime = "nodejs";

type Context = { params: Promise<{ channel: string }> };

function isSyncableChannel(value: string): value is "linkedin" | "whatsapp" {
  return value === "linkedin" || value === "whatsapp";
}

// Fast, non-blocking trigger for the historical import — either the first
// sync after connecting, or a manual resync. Never runs the backfill itself
// (requestConnectionSync only reads/writes connections.metadata.sync); the
// actual work happens in the next runDueConnectionSyncs pass, driven by an
// external cron hitting POST /api/connections/sync/run. Idempotent: calling
// this while a sync is already pending or actively running just returns its
// current state instead of enqueuing a duplicate.
export async function POST(_request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const { channel } = await params;
    if (!isSyncableChannel(channel)) {
      return NextResponse.json({ error: "Canal inconnu." }, { status: 400 });
    }
    const state = await requestConnectionSync(context.workspaceId, channel);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof UnauthorizedError ? "Non authentifié." : error instanceof Error ? error.message : "Erreur serveur." },
      { status: error instanceof UnauthorizedError ? 401 : 400 },
    );
  }
}

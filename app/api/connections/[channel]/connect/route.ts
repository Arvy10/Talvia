import { NextResponse } from "next/server";

import type { ChannelId } from "../../../../app/state/types";
import { createHostedAuthLink, getUnipileConfig } from "../../../../lib/providers/unipile";
import { createConnectionAuthAttempt } from "../../../../lib/providers/unipile-adapter";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";

export const runtime = "nodejs";

type Context = { params: Promise<{ channel: string }> };

function isChannelId(value: string): value is ChannelId {
  return value === "linkedin" || value === "whatsapp" || value === "gmail";
}

// Starts a real Unipile hosted-auth connection instead of the client
// self-reporting a status (the "falsifiable connections" gap flagged by the
// security audit) — the connections row only turns "connected" once the
// notify_url webhook confirms it (see api/webhooks/unipile). A one-time,
// short-lived, opaque token is minted here and embedded in notify_url — the
// only safe way to carry workspace/channel context back through Unipile's
// callback without putting the global UNIPILE_WEBHOOK_SECRET in a URL.
export async function POST(_request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const { channel } = await params;
    if (!isChannelId(channel)) {
      return NextResponse.json({ error: "Canal inconnu." }, { status: 400 });
    }
    const config = getUnipileConfig();
    if (!config) {
      return NextResponse.json({ error: "Unipile n'est pas encore configuré sur cet environnement." }, { status: 503 });
    }
    const { token } = await createConnectionAuthAttempt(context.workspaceId, channel);
    const url = await createHostedAuthLink(config, { channel, workspaceId: context.workspaceId, token });
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." },
      { status: error instanceof UnauthorizedError ? 401 : 400 },
    );
  }
}

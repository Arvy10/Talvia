import { NextResponse } from "next/server";

import { getUnipileConfig, isAccountStatusPayload, isHostedAuthNotifyPayload, type UnipileNewMessagePayload, type UnipileWebhookPayload } from "../../../lib/providers/unipile";
import { ingestAccountStatus, ingestHostedAuthNotification, ingestInboundMessage } from "../../../lib/providers/unipile-adapter";

export const runtime = "nodejs";

// Server-to-server callback from Unipile — no Talvia user session exists
// here, so this is authenticated by a shared secret header instead of
// getCurrentWorkspace(). Configure Unipile's persistent webhook subscription
// with a "Unipile-Auth" header set to UNIPILE_WEBHOOK_SECRET; verify against
// the live dashboard whether the hosted-auth notify_url call also carries
// custom headers once real API access is available — that isn't documented.
export async function POST(request: Request) {
  const config = getUnipileConfig();
  if (!config) {
    return NextResponse.json({ error: "Unipile n'est pas encore configuré sur cet environnement." }, { status: 503 });
  }
  if (request.headers.get("unipile-auth") !== config.webhookSecret) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  let payload: UnipileWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
  }

  try {
    if (isHostedAuthNotifyPayload(payload)) {
      await ingestHostedAuthNotification(payload);
    } else if (isAccountStatusPayload(payload)) {
      await ingestAccountStatus(payload.AccountStatus);
    } else {
      await ingestInboundMessage(payload as UnipileNewMessagePayload);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[webhooks/unipile] ingestion failed", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

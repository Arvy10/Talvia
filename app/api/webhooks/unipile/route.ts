import { NextResponse } from "next/server";

import { getUnipileConfig, isAccountStatusPayload, isHostedAuthNotifyPayload, type UnipileNewMessagePayload, type UnipileWebhookPayload } from "../../../lib/providers/unipile";
import { ingestAccountStatus, ingestHostedAuthNotification, ingestMessage, resolveConnectionAuthAttempt } from "../../../lib/providers/unipile-adapter";

export const runtime = "nodejs";

// Server-to-server callback from Unipile — no Talvia user session exists
// here. Two delivery mechanisms land on this same URL, deliberately
// authenticated two DIFFERENT ways — never mixed:
//   - the hosted-auth `notify_url` (see createHostedAuthLink) carries a
//     single-use, short-lived, opaque `token` query param, minted by
//     POST /api/connections/[channel]/connect and resolved here via
//     resolveConnectionAuthAttempt — this is what tells us the
//     workspace/channel for a brand-new account, never guessed from the
//     payload itself (an AccountStatus event never carries it).
//   - a persistent webhook subscription (created via Unipile's dashboard/API,
//     like this project's "talvia-account-status") is authenticated by a
//     configured "Unipile-Auth" header against UNIPILE_WEBHOOK_SECRET — the
//     global secret never appears in a URL.
// Never logged: the secret, or any raw token. Everything else about a
// received webhook (payload type, account_id, resolved workspace/channel,
// write outcome) is, so a broken delivery is diagnosable without guessing.
export async function POST(request: Request) {
  const config = getUnipileConfig();
  if (!config) {
    return NextResponse.json({ error: "Unipile n'est pas encore configuré sur cet environnement." }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("token");

  let payload: UnipileWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    console.error("[webhooks/unipile] rejected: invalid JSON payload");
    return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
  }

  if (token) {
    // Hosted-auth-notify path — authenticated solely by the token, never by
    // Unipile-Auth (that header may not even be deliverable on this callback
    // shape — see the connect route's own comment on why the token exists).
    if (!isHostedAuthNotifyPayload(payload)) {
      console.error("[webhooks/unipile] rejected: token present but payload is not hosted-auth-notify shaped");
      return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
    }
    const attempt = await resolveConnectionAuthAttempt(token, payload.account_id);
    if (!attempt) {
      console.error("[webhooks/unipile] rejected: unknown/expired token, or already bound to a different account_id");
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }
    try {
      console.log(`[webhooks/unipile] hosted-auth-notify received: status=${payload.status} account_id=${payload.account_id} workspace=${attempt.workspaceId} channel=${attempt.channelType}`);
      await ingestHostedAuthNotification(payload, attempt);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[webhooks/unipile] hosted-auth-notify ingestion failed", error);
      return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
    }
  }

  // Persistent webhook subscription path — server-to-server, authenticated
  // by the shared header only. Never accepts a hosted-auth-notify-shaped
  // payload here (that always carries a token, handled above); this path is
  // for AccountStatus and message events on already-known accounts.
  if (request.headers.get("unipile-auth") !== config.webhookSecret) {
    console.error("[webhooks/unipile] rejected: missing or incorrect Unipile-Auth header");
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  try {
    if (isAccountStatusPayload(payload)) {
      console.log(`[webhooks/unipile] account-status received: message=${payload.AccountStatus.message} account_id=${payload.AccountStatus.account_id}`);
      await ingestAccountStatus(payload.AccountStatus);
    } else {
      await ingestMessage(payload as UnipileNewMessagePayload);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[webhooks/unipile] ingestion failed", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

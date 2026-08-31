import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDueConnectionSyncs } from "../../../../lib/providers/unipile-adapter";
export const runtime = "nodejs";

// External cron entry point for the historical connection-sync job runner —
// same pattern as api/campaigns/engine/run/route.ts and
// api/acquisition/scheduler/route.ts: no in-process background loop (it
// wouldn't survive a restart/redeploy), an external scheduler (Hostinger
// cron, GitHub Actions, etc.) is expected to POST here on an interval. See
// CONNECTION_SYNC_SECRET in .env.example for what must be configured.
function authorized(value: string | null) {
  const secret = process.env.CONNECTION_SYNC_SECRET;
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : null;
  const received = Buffer.from(value ?? "");
  return Boolean(expected && received.length === expected.length && timingSafeEqual(received, expected));
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  return NextResponse.json(await runDueConnectionSyncs());
}

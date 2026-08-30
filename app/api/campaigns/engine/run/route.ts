import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runEngineSweep } from "../../../../lib/campaign-execution/engine";
export const runtime = "nodejs";

// External cron entry point — mirrors api/acquisition/scheduler/route.ts's
// shared-secret pattern exactly. No Next.js setInterval/background loop
// (those don't survive serverless/process restarts); an external
// scheduler (Hostinger cron, GitHub Actions, etc.) is expected to POST here
// on an interval. See CAMPAIGN_ENGINE_SECRET in .env.example for what must
// be configured — this repo cannot provision the external cron itself.
function authorized(value: string | null) {
  const secret = process.env.CAMPAIGN_ENGINE_SECRET;
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : null;
  const received = Buffer.from(value ?? "");
  return Boolean(expected && received.length === expected.length && timingSafeEqual(received, expected));
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  return NextResponse.json(await runEngineSweep());
}

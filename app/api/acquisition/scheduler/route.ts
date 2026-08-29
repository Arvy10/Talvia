import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAcquisitionScheduler } from "../../../lib/acquisition/scheduler";
export const runtime = "nodejs";
function authorized(value: string | null) { const secret = process.env.ACQUISITION_SCHEDULER_SECRET; const expected = secret ? Buffer.from(`Bearer ${secret}`) : null; const received = Buffer.from(value ?? ""); return Boolean(expected && received.length === expected.length && timingSafeEqual(received, expected)); }
export async function POST(request: Request) { if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Non autorisé." }, { status: 401 }); return NextResponse.json(await runAcquisitionScheduler()); }

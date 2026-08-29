import { NextResponse } from "next/server";
import { sendInviteBatch } from "../../../../../lib/prospecting";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// The manually-triggered "Envoyer ce lot" button — see app/lib/prospecting.ts
// for the safe-pacing/claim logic. Each click sends at most one capped batch;
// spreading invitations across the day happens by clicking again later, not
// by a scheduled job (deliberately no cron for V1).
export async function POST(request: Request, { params }: Context) {
  try {
    const body = await request.json().catch(() => ({})) as { limit?: number };
    const result = await sendInviteBatch(await getCurrentWorkspace(), (await params).campaignId, body.limit);
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

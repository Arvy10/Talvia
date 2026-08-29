import { NextResponse } from "next/server";
import { searchProspects, listCandidates } from "../../../../../lib/prospecting";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// GET re-lists previously found candidates (e.g. reopening the review
// screen); POST triggers a new LinkedIn search and stores/updates candidates.
export async function GET(_: Request, { params }: Context) { try { const candidates = await listCandidates(await getCurrentWorkspace(), (await params).campaignId); return NextResponse.json({ candidates }); } catch (error) { return fail(error); } }
export async function POST(request: Request, { params }: Context) { try { const body = await request.json().catch(() => ({})) as { keywords?: string }; const candidates = await searchProspects(await getCurrentWorkspace(), (await params).campaignId, body.keywords); return NextResponse.json({ candidates }); } catch (error) { return fail(error); } }

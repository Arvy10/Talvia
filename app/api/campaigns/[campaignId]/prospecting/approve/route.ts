import { NextResponse } from "next/server";
import { approveProspects } from "../../../../../lib/prospecting";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// The human-review gate — only candidateIds passed here ever become a real
// Contact or a campaign participant.
export async function POST(request: Request, { params }: Context) {
  try {
    const body = await request.json() as { candidateIds?: string[] };
    if (!body.candidateIds?.length) return NextResponse.json({ error: "Sélectionnez au moins un prospect." }, { status: 400 });
    const result = await approveProspects(await getCurrentWorkspace(), (await params).campaignId, body.candidateIds);
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

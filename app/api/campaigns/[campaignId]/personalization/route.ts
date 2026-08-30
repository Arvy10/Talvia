import { NextResponse } from "next/server";
import { generatePersonalizationForCampaign } from "../../../../lib/campaign-personalization";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// Batched generation (controlled concurrency, see campaign-personalization.ts)
// over every approved participant still missing a first proposal — or an
// explicit participantIds list, for a targeted re-generation.
export async function POST(request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const campaignId = (await params).campaignId;
    const body = await request.json().catch(() => ({})) as { participantIds?: string[] };
    const result = await generatePersonalizationForCampaign(context, campaignId, body.participantIds);
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

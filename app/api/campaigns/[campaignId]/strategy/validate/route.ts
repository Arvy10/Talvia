import { NextResponse } from "next/server";
import { validateCampaignStrategy } from "../../../../../lib/campaign-strategy";
import { getCampaignStrategy, saveCampaignStrategy } from "../../../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// The one explicit action that makes a strategy searchable — see
// app/lib/campaign-strategy.ts's validateCampaignStrategy(). Neither
// generating nor editing a strategy ever calls this implicitly.
export async function POST(_: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const campaignId = (await params).campaignId;
    const existing = await getCampaignStrategy(context, campaignId);
    if (!existing) return NextResponse.json({ error: "Aucune stratégie à valider — générez-en une d'abord." }, { status: 404 });
    const validated = validateCampaignStrategy(existing);
    const campaign = await saveCampaignStrategy(context, campaignId, validated);
    if (!campaign) return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
    return NextResponse.json({ strategy: campaign.strategy });
  } catch (error) {
    return fail(error);
  }
}

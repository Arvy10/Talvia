import { NextResponse } from "next/server";
import { applyStrategyEdit, generateCampaignStrategy, InsufficientBusinessContextError, preserveManualStrategyFields, type CampaignStrategyEditInput } from "../../../../lib/campaign-strategy";
import { getCampaignStrategy, saveCampaignStrategy } from "../../../../lib/campaigns";
import { getActiveBusinessContext } from "../../../../lib/business-context/business-context-service";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (error instanceof InsufficientBusinessContextError) return NextResponse.json({ error: error.message }, { status: 422 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 });
}

// GET re-reads the persisted strategy (e.g. reopening the campaign);
// POST (re)generates it from the active Business Context, preserving any
// field the user already corrected by hand; PATCH applies a direct human
// edit. Nothing here calls an AI vendor SDK directly — see
// app/lib/campaign-strategy.ts.
export async function GET(_: Request, { params }: Context) {
  try {
    const strategy = await getCampaignStrategy(await getCurrentWorkspace(), (await params).campaignId);
    return NextResponse.json({ strategy });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(_: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const campaignId = (await params).campaignId;
    const businessContext = await getActiveBusinessContext(context);
    const existing = await getCampaignStrategy(context, campaignId);
    const fresh = await generateCampaignStrategy(businessContext);
    const strategy = preserveManualStrategyFields(existing, fresh);
    const campaign = await saveCampaignStrategy(context, campaignId, strategy);
    if (!campaign) return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
    return NextResponse.json({ strategy: campaign.strategy });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const campaignId = (await params).campaignId;
    const body = await request.json() as CampaignStrategyEditInput;
    const existing = await getCampaignStrategy(context, campaignId);
    if (!existing) return NextResponse.json({ error: "Aucune stratégie à modifier — générez-en une d'abord." }, { status: 404 });
    const updated = applyStrategyEdit(existing, body);
    const campaign = await saveCampaignStrategy(context, campaignId, updated);
    if (!campaign) return NextResponse.json({ error: "Campagne introuvable." }, { status: 404 });
    return NextResponse.json({ strategy: campaign.strategy });
  } catch (error) {
    return fail(error);
  }
}

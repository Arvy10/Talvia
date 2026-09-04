import { NextResponse } from "next/server";
import { runDueCampaignActions } from "../../../../../lib/campaign-execution/engine";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

const BLOCKED_REASON_MESSAGES: Partial<Record<string, string>> = {
  NO_LINKEDIN_CONNECTION: "Aucun compte LinkedIn connecté.",
  NO_WHATSAPP_CONNECTION: "Aucun compte WhatsApp connecté.",
  NO_EMAIL_CONNECTION: "Aucune boîte e-mail connectée.",
  NOT_ELIGIBLE: "Campagne introuvable.",
  CAMPAIGN_PAUSED: "La campagne doit être activée avant d'envoyer des invitations.",
  NO_STEP_CONFIGURED: "Cette campagne n'a aucune étape exécutable.",
  DAILY_LIMIT_REACHED: "La limite quotidienne d'invitations est atteinte — réessayez demain.",
};

// The manually-triggered "Envoyer ce lot" button. Runs through the exact
// same runDueCampaignActions() the cron-triggered engine sweep uses (see
// app/lib/campaign-execution/engine.ts and api/campaigns/engine/run) — this
// button is a manual invocation of the engine, not a separate send path.
export async function POST(request: Request, { params }: Context) {
  try {
    const body = await request.json().catch(() => ({})) as { limit?: number };
    const context = await getCurrentWorkspace();
    const campaignId = (await params).campaignId;
    const result = await runDueCampaignActions(context, campaignId, { limit: body.limit });
    if (result.blockedReason) {
      return NextResponse.json({ error: BLOCKED_REASON_MESSAGES[result.blockedReason] ?? "Envoi impossible." }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

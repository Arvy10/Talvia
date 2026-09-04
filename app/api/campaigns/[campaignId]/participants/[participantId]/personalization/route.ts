import { NextResponse } from "next/server";
import { database } from "../../../../../../lib/database";
import { editParticipantInvitation, editParticipantMessage, generateEmailParticipantPersonalization, generateParticipantPersonalization, generateWhatsAppParticipantPersonalization, getParticipantPersonalization } from "../../../../../../lib/campaign-personalization";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string; participantId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// GET reads the current evidence/angle/invitation/message state for one
// participant; POST (re)generates it (never overwriting an approved text —
// see campaign-personalization.ts); PATCH applies a human edit to either
// the invitation note or one message step.
export async function GET(_: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const p = await params;
    const personalization = await getParticipantPersonalization(context, p.campaignId, p.participantId);
    if (!personalization) return NextResponse.json({ error: "Participant introuvable." }, { status: 404 });
    return NextResponse.json({ personalization });
  } catch (error) {
    return fail(error);
  }
}

// WhatsApp and email participants are existing Contacts, never LinkedIn
// search candidates — dispatched to the channel-appropriate generator by the
// campaign's own channel_type, never guessed from the request. Sending an
// email participant to the LinkedIn generator (which requires a
// campaign_prospect_candidates row) is why an email campaign could never
// produce an approvable text at all.
export async function POST(_: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const p = await params;
    const campaign = await database.query<{ channel_type: string }>(`select channel_type from campaigns where workspace_id=$1 and id=$2`, [context.workspaceId, p.campaignId]);
    const channelType = campaign.rows[0]?.channel_type;
    const result = channelType === "whatsapp"
      ? await generateWhatsAppParticipantPersonalization(context, p.campaignId, p.participantId)
      : channelType === "email"
        ? await generateEmailParticipantPersonalization(context, p.campaignId, p.participantId)
        : await generateParticipantPersonalization(context, p.campaignId, p.participantId);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
    return NextResponse.json({ personalization: result.personalization });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const p = await params;
    const body = await request.json() as { field?: "invitation" | "message"; stepId?: string; text?: string };
    if (!body.text?.trim()) return NextResponse.json({ error: "Le texte ne peut pas être vide." }, { status: 400 });

    const personalization = body.field === "message"
      ? body.stepId ? await editParticipantMessage(context, p.campaignId, p.participantId, body.stepId, body.text) : null
      : await editParticipantInvitation(context, p.campaignId, p.participantId, body.text);

    if (!personalization) return NextResponse.json({ error: "Participant introuvable ou étape invalide." }, { status: 404 });
    return NextResponse.json({ personalization });
  } catch (error) {
    return fail(error);
  }
}

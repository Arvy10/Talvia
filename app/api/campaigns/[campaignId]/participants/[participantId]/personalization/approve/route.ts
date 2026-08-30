import { NextResponse } from "next/server";
import { approveParticipantInvitation, approveParticipantMessage } from "../../../../../../../lib/campaign-personalization";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../../../lib/workspace-context";
export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string; participantId: string }> };
function fail(error: unknown) { if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 }); }

// The only action that makes a generated/edited text executable (docs spec
// §9/§12) — only the approvedText this produces is ever sent by the
// LinkedIn executor.
export async function POST(request: Request, { params }: Context) {
  try {
    const context = await getCurrentWorkspace();
    const p = await params;
    const body = await request.json() as { field?: "invitation" | "message"; stepId?: string };

    const personalization = body.field === "message"
      ? body.stepId ? await approveParticipantMessage(context, p.campaignId, p.participantId, body.stepId) : null
      : await approveParticipantInvitation(context, p.campaignId, p.participantId);

    if (!personalization) return NextResponse.json({ error: "Rien à approuver — générez d'abord un texte." }, { status: 404 });
    return NextResponse.json({ personalization });
  } catch (error) {
    return fail(error);
  }
}

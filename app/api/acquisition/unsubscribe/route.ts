import { NextResponse } from "next/server";

import { unsubscribeBetaLead } from "../../../lib/acquisition/leads";
import { verifyUnsubscribeToken } from "../../../lib/acquisition/unsubscribe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const leadId = token ? verifyUnsubscribeToken(token) : null;
  if (!leadId) return new NextResponse("Lien de désinscription invalide.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  await unsubscribeBetaLead(leadId);
  return new NextResponse("Vous êtes désinscrit(e) des e-mails de la bêta Talvia.", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

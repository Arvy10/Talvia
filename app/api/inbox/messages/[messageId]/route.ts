import { NextResponse } from "next/server";
import { editMessage } from "../../../../lib/providers/unipile-adapter";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime = "nodejs";
type C = { params: Promise<{ messageId: string }> };
const fail = (e: unknown) => NextResponse.json({ error: e instanceof UnauthorizedError ? "Non authentifié." : e instanceof Error ? e.message : "Erreur serveur." }, { status: e instanceof UnauthorizedError ? 401 : 400 });

export async function PATCH(r: Request, { params }: C) {
  try {
    const context = await getCurrentWorkspace();
    const messageId = (await params).messageId;
    const body = await r.json() as { body?: string };
    if (!body.body?.trim()) return NextResponse.json({ error: "Le message est vide." }, { status: 400 });

    await editMessage(context.workspaceId, messageId, body.body.trim());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

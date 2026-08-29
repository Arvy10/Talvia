import { NextResponse } from "next/server";
import { database } from "../../../../../lib/database";
import { getMessageAttachment, getUnipileConfig } from "../../../../../lib/providers/unipile";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type C = { params: Promise<{ messageId: string; attachmentId: string }> };

// Proxies Unipile's attachment download so UNIPILE_API_KEY never reaches the
// browser and so access stays workspace-scoped — the message row must belong
// to the caller's own workspace before we'll fetch anything from Unipile.
export async function GET(_: Request, { params }: C) {
  try {
    const context = await getCurrentWorkspace();
    const { messageId, attachmentId } = await params;
    const config = getUnipileConfig();
    if (!config) return NextResponse.json({ error: "Unipile n'est pas configuré sur cet environnement." }, { status: 503 });

    const owned = await database.query<{ id: string }>(
      `select m.id from messages m where m.workspace_id=$1 and m.id=$2`,
      [context.workspaceId, messageId],
    );
    if (!owned.rows[0]) return NextResponse.json({ error: "Message introuvable." }, { status: 404 });

    const { body, contentType } = await getMessageAttachment(config, messageId, attachmentId);
    return new NextResponse(body, {
      headers: {
        "content-type": contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." }, { status: e instanceof UnauthorizedError ? 401 : 400 });
  }
}

import { NextResponse } from "next/server";
import { database } from "../../../../../lib/database";
import { createDraft, getConversation } from "../../../../../lib/inbox";
import { sendMessage } from "../../../../../lib/providers/unipile-adapter";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime = "nodejs";
type C = { params: Promise<{ conversationId: string }> };
const fail = (e: unknown) => NextResponse.json({ error: e instanceof UnauthorizedError ? "Non authentifié." : e instanceof Error ? e.message : "Erreur serveur." }, { status: e instanceof UnauthorizedError ? 401 : 400 });

export async function GET(_: Request, { params }: C) { try { const v = await getConversation(await getCurrentWorkspace(), (await params).conversationId); return v ? NextResponse.json({ messages: v.messages }) : NextResponse.json({ error: "Conversation introuvable." }, { status: 404 }); } catch (e) { return fail(e); } }

// A conversation whose thread is tied to a real Unipile connection sends for
// real (see lib/providers/unipile-adapter.ts sendMessage — a genuine,
// irreversible LinkedIn message). Everything else — sandbox/manually-created
// conversations with no real provider behind them — keeps the original
// local-draft behavior.
export async function POST(r: Request, { params }: C) {
  try {
    const context = await getCurrentWorkspace();
    const conversationId = (await params).conversationId;
    const body = await r.json() as { body?: string };
    if (!body.body?.trim()) return NextResponse.json({ error: "Le message est vide." }, { status: 400 });
    const text = body.body.trim();

    const linked = await database.query<{ is_unipile: boolean }>(
      `select (v.connection_id is not null and c.provider='unipile') is_unipile from conversations v left join connections c on c.id=v.connection_id where v.workspace_id=$1 and v.id=$2`,
      [context.workspaceId, conversationId],
    );
    if (!linked.rows[0]) return NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });

    if (linked.rows[0].is_unipile) {
      const message = await sendMessage(context.workspaceId, conversationId, text);
      return NextResponse.json({ message }, { status: 201 });
    }

    const m = await createDraft(context, conversationId, text);
    return m ? NextResponse.json({ message: m }, { status: 201 }) : NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

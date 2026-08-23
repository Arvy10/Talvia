import { NextResponse } from "next/server";

import { database } from "../../../../../lib/database";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  try {
    const context = await getCurrentWorkspace();
    const opportunityId = (await params).opportunityId;
    const owned = await database.query(
      "select id from opportunities where workspace_id=$1 and id=$2",
      [context.workspaceId, opportunityId],
    );
    if (!owned.rowCount) return NextResponse.json({ error: "Introuvable." }, { status: 404 });
    const result = await database.query(
      `select id,event_type,metadata,created_at
       from activities
       where workspace_id=$1 and entity_type='opportunity' and entity_id=$2
       order by created_at desc`,
      [context.workspaceId, opportunityId],
    );
    return NextResponse.json({ activities: result.rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." },
      { status: error instanceof UnauthorizedError ? 401 : 400 },
    );
  }
}

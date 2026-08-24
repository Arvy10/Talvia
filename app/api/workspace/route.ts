import { NextResponse } from "next/server";

import { database } from "../../lib/database";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentWorkspace();
    const result = await database.query(
      `select w.id,w.name,w.default_locale,w.default_timezone,u.first_name,u.last_name,u.email
       from workspaces w join users u on u.id=$2 where w.id=$1`,
      [context.workspaceId, context.userId],
    );
    return NextResponse.json({ workspace: result.rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." }, { status: error instanceof UnauthorizedError ? 401 : 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getCurrentWorkspace();
    const input = await request.json() as { name?: string; firstName?: string; lastName?: string; locale?: string; timezone?: string };
    if (input.name !== undefined) await database.query("update workspaces set name=$1,default_locale=coalesce($2,default_locale),default_timezone=coalesce($3,default_timezone),updated_at=now() where id=$4", [input.name.trim(), input.locale ?? null, input.timezone ?? null, context.workspaceId]);
    if (input.firstName !== undefined || input.lastName !== undefined) await database.query("update users set first_name=coalesce($1,first_name),last_name=coalesce($2,last_name),updated_at=now() where id=$3", [input.firstName ?? null, input.lastName ?? null, context.userId]);
    return GET();
  } catch (error) {
    return NextResponse.json({ error: error instanceof UnauthorizedError ? "Non authentifié." : "Erreur serveur." }, { status: error instanceof UnauthorizedError ? 401 : 400 });
  }
}

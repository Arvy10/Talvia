import { NextResponse } from "next/server";

import { auth } from "../../../lib/auth";
import { ensureWorkspaceForUser } from "../../../lib/workspace-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const workspace = await ensureWorkspaceForUser({ id: session.user.id, email: session.user.email, name: session.user.name });
  return NextResponse.json({ workspace });
}

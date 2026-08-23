import { NextResponse } from "next/server";

import { database } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await database.query<{ database: string }>("select current_database() as database");
    return NextResponse.json({ connected: true, database: result.rows[0]?.database ?? null });
  } catch {
    return NextResponse.json({ connected: false }, { status: 503 });
  }
}

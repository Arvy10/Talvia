import { NextResponse } from "next/server";

import { registerBetaLead } from "../../../lib/acquisition/leads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const result = await registerBetaLead(await request.json());
    return NextResponse.json({ ok: true, alreadyRegistered: !result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inscription impossible.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { createContact, listContacts, type ContactInput } from "../../lib/contacts";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (typeof error === "object" && error && "code" in error && error.code === "23505") return NextResponse.json({ error: "Cette identité de contact existe déjà dans votre espace." }, { status: 409 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 });
}

export async function GET() {
  try { return NextResponse.json({ contacts: await listContacts(await getCurrentWorkspace()) }); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return NextResponse.json({ contact: await createContact(await getCurrentWorkspace(), await request.json() as ContactInput) }, { status: 201 }); } catch (error) { return errorResponse(error); }
}

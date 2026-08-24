import { NextResponse } from "next/server";

import { archiveContact, getContact, updateContact, type ContactInput } from "../../../lib/contacts";
import { getCurrentWorkspace, UnauthorizedError } from "../../../lib/workspace-context";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (typeof error === "object" && error && "code" in error && error.code === "23505") return NextResponse.json({ error: "Cette identité de contact existe déjà dans votre espace." }, { status: 409 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 400 });
}

export async function GET(_: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try { const contact = await getContact(await getCurrentWorkspace(), (await params).contactId); return contact ? NextResponse.json({ contact }) : NextResponse.json({ error: "Introuvable." }, { status: 404 }); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try { const contact = await updateContact(await getCurrentWorkspace(), (await params).contactId, await request.json() as ContactInput); return contact ? NextResponse.json({ contact }) : NextResponse.json({ error: "Introuvable." }, { status: 404 }); } catch (error) { return errorResponse(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try { const archived = await archiveContact(await getCurrentWorkspace(), (await params).contactId); return archived ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Introuvable." }, { status: 404 }); } catch (error) { return errorResponse(error); }
}

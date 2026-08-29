import { NextResponse } from "next/server";
import { ingestResendEvent, verifyResendWebhook } from "../../../lib/acquisition/webhook";
export const runtime = "nodejs";
export async function POST(request: Request) { const raw = await request.text(); if (!verifyResendWebhook(raw, request.headers)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 }); try { return NextResponse.json({ ok: true, duplicate: (await ingestResendEvent(JSON.parse(raw))).toString() === "duplicate" }); } catch { return NextResponse.json({ error: "Payload invalide." }, { status: 400 }); } }

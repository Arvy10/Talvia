import { createHmac, timingSafeEqual } from "node:crypto";
import { database } from "../database";

function signature(rawBody: string, timestamp: string) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.replace(/^whsec_/, "");
  if (!secret) return null;
  return createHmac("sha256", Buffer.from(secret, "base64")).update(`${timestamp}.${rawBody}`).digest("base64");
}
export function verifyResendWebhook(rawBody: string, headers: Headers) {
  const timestamp = headers.get("svix-timestamp"); const values = headers.get("svix-signature")?.split(" ").map((item) => item.replace(/^v1,/, "")) ?? [];
  const expected = timestamp ? signature(rawBody, timestamp) : null;
  return Boolean(expected && values.some((value) => { const actual = Buffer.from(value); const target = Buffer.from(expected); return actual.length === target.length && timingSafeEqual(actual, target); }));
}
export async function ingestResendEvent(event: { id?: unknown; type?: unknown; data?: { email_id?: unknown } }) {
  if (typeof event.id !== "string" || typeof event.type !== "string") throw new Error("Événement Resend invalide.");
  const providerMessageId = typeof event.data?.email_id === "string" ? event.data.email_id : null;
  const result = await database.query<{ id: string }>("insert into acquisition_email_events(delivery_id,provider_event_id,event_type,payload) values((select id from acquisition_email_deliveries where provider_message_id=$1),$2,$3,$4) on conflict(provider_event_id) do nothing returning id", [providerMessageId, event.id, event.type, event]);
  if (!result.rows[0]) return "duplicate" as const;
  if (providerMessageId && event.type === "email.bounced") await database.query("update acquisition_email_deliveries set status='failed',last_error='Resend bounce',updated_at=now() where provider_message_id=$1", [providerMessageId]);
  return "processed" as const;
}

import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.ACQUISITION_UNSUBSCRIBE_SECRET?.trim();
  if (!value) throw new Error("ACQUISITION_UNSUBSCRIBE_SECRET doit être configurée.");
  return value;
}

export function createUnsubscribeToken(leadId: string) {
  const signature = createHmac("sha256", secret()).update(leadId).digest("base64url");
  return `${Buffer.from(leadId).toString("base64url")}.${signature}`;
}

export function verifyUnsubscribeToken(token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  let leadId: string;
  try { leadId = Buffer.from(encoded, "base64url").toString("utf8"); } catch { return null; }
  if (!/^[0-9a-f-]{3,}$/i.test(leadId)) return null;
  const expected = createHmac("sha256", secret()).update(leadId).digest("base64url");
  const actualBytes = Buffer.from(signature); const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) ? leadId : null;
}

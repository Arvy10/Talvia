import { database } from "../database";
import type { LeadRegistrationInput, NormalizedLeadInput } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_VALUE_LENGTH = 500;

export function normalizeAcquisitionEmail(value: string) {
  return value.trim().toLowerCase();
}

function optionalString(value: unknown, field: string, maxLength = MAX_VALUE_LENGTH) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} invalide.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new Error(`${field} est trop long.`);
  return trimmed;
}

export function validateLeadInput(input: LeadRegistrationInput): NormalizedLeadInput {
  if (!input || typeof input !== "object") throw new Error("Données d'inscription invalides.");
  const emailValue = optionalString(input.email, "Adresse e-mail", 254);
  if (!emailValue || !EMAIL_PATTERN.test(emailValue)) throw new Error("Saisissez une adresse e-mail valide.");
  const landingUrl = optionalString(input.landingUrl, "URL de landing", 2048);
  if (landingUrl) {
    try { new URL(landingUrl); } catch { throw new Error("URL de landing invalide."); }
  }
  return {
    email: normalizeAcquisitionEmail(emailValue), firstName: optionalString(input.firstName, "Prénom", 100), role: optionalString(input.role, "Activité", 200),
    source: optionalString(input.source, "Source", 100), utmSource: optionalString(input.utmSource, "UTM source", 100), utmMedium: optionalString(input.utmMedium, "UTM medium", 100),
    utmCampaign: optionalString(input.utmCampaign, "UTM campaign", 200), utmContent: optionalString(input.utmContent, "UTM content", 200), utmTerm: optionalString(input.utmTerm, "UTM term", 200), landingUrl,
  };
}

export async function registerBetaLead(input: LeadRegistrationInput) {
  const lead = validateLeadInput(input);
  const client = await database.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string }>("select id from beta_leads where email_normalized=$1", [lead.email]);
    if (existing.rows[0]) { await client.query("commit"); return { created: false, leadId: existing.rows[0].id }; }
    const inserted = await client.query<{ id: string }>(
      `insert into beta_leads(email,email_normalized,first_name,role,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_url,consent_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) returning id`,
      [lead.email, lead.email, lead.firstName, lead.role, lead.source, lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.utmContent, lead.utmTerm, lead.landingUrl],
    );
    const leadId = inserted.rows[0]!.id;
    await client.query(
      `insert into acquisition_email_deliveries(lead_id,email_type,scheduled_at) values($1,'welcome',now()),($1,'day_1',now()+interval '1 day'),($1,'day_3',now()+interval '3 days')`,
      [leadId],
    );
    await client.query("commit");
    return { created: true, leadId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export async function unsubscribeBetaLead(leadId: string) {
  const client = await database.connect();
  try {
    await client.query("begin");
    await client.query("update beta_leads set status='UNSUBSCRIBED',unsubscribed_at=coalesce(unsubscribed_at,now()),updated_at=now() where id=$1", [leadId]);
    await client.query("update acquisition_email_deliveries set status='cancelled',updated_at=now() where lead_id=$1 and status in ('pending','failed')", [leadId]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

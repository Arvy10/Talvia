import type { PoolClient } from "pg";

import { database } from "./database";
import { dispatchCommittedActivity, recordActivity } from "./activities";
import type { WorkspaceContext } from "./workspace-context";

export type ContactStatus = "new" | "lead" | "prospect" | "follow_up" | "qualified" | "client" | "inactive" | "other";
export type ContactRecord = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  channel?: "linkedin" | "whatsapp" | "gmail";
  company?: string;
  role?: string;
  website?: string;
  status: ContactStatus;
  notes?: string;
  notesUpdatedAt?: string;
};

export type ContactInput = Omit<ContactRecord, "id" | "channel" | "notesUpdatedAt">;

type ContactRow = {
  id: string; display_name: string; job_title: string | null; status: ContactStatus; notes_summary: string | null;
  company: string | null; website_url: string | null; created_at: string;
  email: string | null; phone: string | null; linkedin_url: string | null;
};

function normalizedEmail(value: string) { return value.trim().toLowerCase(); }
function normalizedPhone(value: string) { return value.replace(/[^\d+]/g, ""); }
function normalizedLinkedIn(value: string) { return value.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""); }
function clean(value?: string) { return value?.trim() || undefined; }

function contactFromRow(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    name: row.display_name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.linkedin_url ? { linkedinUrl: row.linkedin_url } : {}),
    channel: row.linkedin_url ? "linkedin" : row.phone ? "whatsapp" : row.email ? "gmail" : undefined,
    ...(row.company ? { company: row.company } : {}),
    ...(row.job_title ? { role: row.job_title } : {}),
    ...(row.website_url ? { website: row.website_url } : {}),
    status: row.status,
    ...(row.notes_summary ? { notes: row.notes_summary, notesUpdatedAt: row.created_at } : {}),
  };
}

const contactSelect = `
  select c.id, c.display_name, c.job_title, c.status, c.notes_summary, c.created_at,
         company.name as company, company.website_url,
         max(ci.identifier) filter (where ci.channel_type = 'email') as email,
         max(ci.identifier) filter (where ci.channel_type = 'whatsapp') as phone,
         max(ci.profile_url) filter (where ci.channel_type = 'linkedin') as linkedin_url
  from contacts c
  left join companies company on company.id = c.company_id and company.workspace_id = c.workspace_id
  left join contact_identities ci on ci.contact_id = c.id and ci.workspace_id = c.workspace_id
`;

function validate(input: ContactInput) {
  const name = clean(input.name);
  const email = clean(input.email);
  const phone = clean(input.phone);
  const linkedinUrl = clean(input.linkedinUrl);
  if (!name) throw new Error("Le nom du contact est requis.");
  if (!email && !phone && !linkedinUrl) throw new Error("Ajoutez au moins un moyen de contact.");
  return { ...input, name, email, phone, linkedinUrl, company: clean(input.company), role: clean(input.role), website: clean(input.website), notes: clean(input.notes) };
}

async function resolveCompany(client: PoolClient, workspaceId: string, name?: string, website?: string) {
  if (!name) return null;
  const existing = await client.query<{ id: string }>(
    `select id from companies where workspace_id = $1 and lower(name) = lower($2) order by created_at asc limit 1`,
    [workspaceId, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query<{ id: string }>(
    `insert into companies (workspace_id, name, website_url) values ($1, $2, $3) returning id`,
    [workspaceId, name, website ?? null],
  );
  return created.rows[0]!.id;
}

async function replaceIdentities(client: PoolClient, workspaceId: string, contactId: string, input: ReturnType<typeof validate>) {
  await client.query(`delete from contact_identities where workspace_id = $1 and contact_id = $2`, [workspaceId, contactId]);
  const identities = [
    input.email ? ["email", input.email, normalizedEmail(input.email), null] : null,
    input.phone ? ["whatsapp", input.phone, normalizedPhone(input.phone), null] : null,
    input.linkedinUrl ? ["linkedin", input.linkedinUrl, normalizedLinkedIn(input.linkedinUrl), input.linkedinUrl] : null,
  ].filter(Boolean) as [string, string, string, string | null][];
  for (const [channel, identifier, normalized, profileUrl] of identities) {
    await client.query(
      `insert into contact_identities (workspace_id, contact_id, channel_type, identifier, identifier_normalized, profile_url)
       values ($1, $2, $3, $4, $5, $6)`,
      [workspaceId, contactId, channel, identifier, normalized, profileUrl],
    );
  }
}

async function findById(client: PoolClient, workspaceId: string, contactId: string) {
  const result = await client.query<ContactRow>(`${contactSelect} where c.workspace_id = $1 and c.id = $2 and c.archived_at is null group by c.id, company.id`, [workspaceId, contactId]);
  return result.rows[0] ? contactFromRow(result.rows[0]) : null;
}

export async function listContacts(context: WorkspaceContext) {
  const result = await database.query<ContactRow>(`${contactSelect} where c.workspace_id = $1 and c.archived_at is null group by c.id, company.id order by c.display_name asc`, [context.workspaceId]);
  return result.rows.map(contactFromRow);
}

export async function getContact(context: WorkspaceContext, contactId: string) {
  const client = await database.connect();
  try { return await findById(client, context.workspaceId, contactId); } finally { client.release(); }
}

export async function createContact(context: WorkspaceContext, rawInput: ContactInput) {
  const input = validate(rawInput);
  const client = await database.connect();
  try {
    await client.query("begin");
    const companyId = await resolveCompany(client, context.workspaceId, input.company, input.website);
    const result = await client.query<{ id: string }>(
      `insert into contacts (workspace_id, company_id, display_name, job_title, status, notes_summary)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [context.workspaceId, companyId, input.name, input.role ?? null, input.status, input.notes ?? null],
    );
    const contactId = result.rows[0]!.id;
    await replaceIdentities(client, context.workspaceId, contactId, input);
    const activity = await recordActivity(context, { eventType: "contact.created", entityType: "contact", entityId: contactId, metadata: { contactId } }, client);
    const contact = await findById(client, context.workspaceId, contactId);
    await client.query("commit");
    await dispatchCommittedActivity(activity);
    return contact!;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function updateContact(context: WorkspaceContext, contactId: string, rawInput: ContactInput) {
  const input = validate(rawInput);
  const client = await database.connect();
  try {
    await client.query("begin");
    const existing = await findById(client, context.workspaceId, contactId);
    if (!existing) { await client.query("rollback"); return null; }
    const companyId = await resolveCompany(client, context.workspaceId, input.company, input.website);
    await client.query(`update contacts set company_id = $1, display_name = $2, job_title = $3, status = $4, notes_summary = $5, updated_at = now() where workspace_id = $6 and id = $7`, [companyId, input.name, input.role ?? null, input.status, input.notes ?? null, context.workspaceId, contactId]);
    await replaceIdentities(client, context.workspaceId, contactId, input);
    const activity = await recordActivity(context, { eventType: existing.status !== input.status ? "contact.status_changed" : "contact.updated", entityType: "contact", entityId: contactId, metadata: { contactId, status: input.status } }, client);
    const contact = await findById(client, context.workspaceId, contactId);
    await client.query("commit");
    await dispatchCommittedActivity(activity);
    return contact!;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function archiveContact(context: WorkspaceContext, contactId: string) {
  const result = await database.query(`update contacts set archived_at = now(), updated_at = now() where workspace_id = $1 and id = $2 and archived_at is null returning id`, [context.workspaceId, contactId]);
  if (result.rowCount) {
    const activity = await recordActivity(context, { eventType: "contact.archived", entityType: "contact", entityId: contactId, metadata: { contactId } });
    await dispatchCommittedActivity(activity);
  }
  return Boolean(result.rowCount);
}

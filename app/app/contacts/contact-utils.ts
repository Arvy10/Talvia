import type { Contact } from "../state/types";

export const normalizeEmail = (value?: string) => value?.trim().toLowerCase() ?? "";
export const normalizePhone = (value?: string) => value?.replace(/[^\d+]/g, "") ?? "";
export const normalizeLinkedIn = (value?: string) => value?.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") ?? "";

export function findDuplicateContact(contacts: Contact[], candidate: Partial<Contact>, ignoreId?: string): Contact | undefined {
  const email = normalizeEmail(candidate.email);
  const phone = normalizePhone(candidate.phone);
  const linkedin = normalizeLinkedIn(candidate.linkedinUrl);
  return contacts.find((contact) => contact.id !== ignoreId && ((email && normalizeEmail(contact.email) === email) || (phone && normalizePhone(contact.phone) === phone) || (linkedin && normalizeLinkedIn(contact.linkedinUrl) === linkedin)));
}

export type CsvContact = { firstName: string; lastName: string; email: string; phone: string; company: string; role: string; linkedinUrl: string; valid: boolean; duplicate: boolean };
export function parseContactsCsv(text: string, contacts: Contact[]): CsvContact[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((item) => item.trim().toLowerCase());
  const value = (cells: string[], key: string) => cells[headers.indexOf(key)]?.trim().replace(/^"|"$/g, "") ?? "";
  return lines.slice(1).map((line) => { const cells = line.split(","); const row = { firstName: value(cells, "first_name"), lastName: value(cells, "last_name"), email: value(cells, "email"), phone: value(cells, "phone"), company: value(cells, "company"), role: value(cells, "job_title"), linkedinUrl: value(cells, "linkedin_url") }; const candidate = { name: `${row.firstName} ${row.lastName}`.trim(), email: row.email, phone: row.phone, linkedinUrl: row.linkedinUrl }; return { ...row, valid: Boolean(candidate.name && (row.email || row.phone || row.linkedinUrl)), duplicate: Boolean(findDuplicateContact(contacts, candidate)) }; });
}

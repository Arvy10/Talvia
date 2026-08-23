import { mkdirSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:3000";
const headers = { origin: base, "content-type": "application/json" };
const stamp = Date.now();
const results = [];

mkdirSync("validation", { recursive: true });
const flush = () => writeFileSync("validation/inbox-validation.json", JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
const record = (scenario, expected, actual, pass) => {
  results.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
  flush();
  console.log(`${pass ? "PASS" : "FAIL"} ${scenario} ${actual}`);
};
const api = (path, options = {}) => fetch(`${base}${path}`, options);

async function createUser(label) {
  const email = `inbox-${label}-${stamp}@example.test`;
  const password = "Test-password-2026!";
  const signup = await api("/api/auth/sign-up/email", { method: "POST", headers, body: JSON.stringify({ name: `Inbox ${label}`, email, password }) });
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const provision = await api("/api/workspace/provision", { method: "POST", headers: { origin: base, cookie } });
  record(`user_${label}`, "signup/provision 200", `${signup.status}/${provision.status}`, signup.status === 200 && provision.status === 200);
  return { email, password, cookie };
}

async function createContact(user, label) {
  const response = await api("/api/contacts", { method: "POST", headers: { ...headers, cookie: user.cookie }, body: JSON.stringify({ name: `Inbox contact ${label}`, email: `inbox-contact-${label}-${stamp}@example.test`, status: "new" }) });
  return (await response.json()).contact;
}

flush();
const userA = await createUser("a");
const userB = await createUser("b");
const contactA = await createContact(userA, "a");
const contactB = await createContact(userB, "b");

let response = await api("/api/inbox/conversations", { method: "POST", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ contactIds: [contactA.id], channel: "email" }) });
let payload = await response.json();
const conversationId = payload.conversation?.id;
record("create_conversation", "201", String(response.status), response.status === 201);
record("participants_persisted", "contact participant returned", String(payload.conversation?.contactId === contactA.id), payload.conversation?.contactId === contactA.id);

response = await api("/api/inbox/conversations", { method: "POST", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ contactIds: [contactA.id, contactB.id], channel: "email" }) });
record("foreign_contact_refused", "400", String(response.status), response.status === 400);
response = await api("/api/inbox/conversations", { headers: { cookie: userA.cookie } });
payload = await response.json();
record("transaction_rollback", "only initial conversation remains", String(payload.conversations?.length), payload.conversations?.length === 1);

response = await api(`/api/inbox/conversations/${conversationId}/test-inbound`, { method: "POST", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ body: "Bonjour", providerMessageId: `provider-${stamp}` }) });
record("inbound_persisted", "201", String(response.status), response.status === 201);
response = await api(`/api/inbox/conversations/${conversationId}/messages`, { method: "POST", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ body: "Brouillon persistant" }) });
record("draft_persisted", "201", String(response.status), response.status === 201);
response = await api(`/api/inbox/conversations/${conversationId}/read`, { method: "PATCH", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ read: false }) });
record("unread_persisted", "200", String(response.status), response.status === 200);
response = await api("/api/inbox/conversations", { headers: { cookie: userA.cookie } });
payload = await response.json();
record("unread_state_persisted", "unread true", String(payload.conversations?.[0]?.unread), payload.conversations?.[0]?.unread === true);
response = await api(`/api/inbox/conversations/${conversationId}/read`, { method: "PATCH", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ read: true }) });
record("read_persisted", "200", String(response.status), response.status === 200);

for (const [scenario, path, options] of [
  ["cross_read", `/api/inbox/conversations/${conversationId}`, { headers: { cookie: userB.cookie } }],
  ["cross_messages", `/api/inbox/conversations/${conversationId}/messages`, { headers: { cookie: userB.cookie } }],
  ["cross_draft", `/api/inbox/conversations/${conversationId}/messages`, { method: "POST", headers: { ...headers, cookie: userB.cookie }, body: JSON.stringify({ body: "x" }) }],
  ["cross_archive", `/api/inbox/conversations/${conversationId}`, { method: "PATCH", headers: { ...headers, cookie: userB.cookie }, body: JSON.stringify({ action: "archive" }) }],
]) {
  const cross = await api(path, options);
  record(scenario, "404", String(cross.status), cross.status === 404);
}

response = await api(`/api/inbox/conversations/${conversationId}`, { method: "PATCH", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ action: "archive" }) });
record("archive", "200", String(response.status), response.status === 200);
response = await api(`/api/inbox/conversations/${conversationId}`, { method: "PATCH", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ action: "reopen" }) });
record("reopen", "200", String(response.status), response.status === 200);
response = await api(`/api/inbox/conversations/${conversationId}/test-inbound`, { method: "POST", headers: { ...headers, cookie: userA.cookie }, body: JSON.stringify({ body: "Doublon", providerMessageId: `provider-${stamp}` }) });
record("provider_deduplication", "200 duplicate", String(response.status), response.status === 200);

await api("/api/auth/sign-out", { method: "POST", headers: { ...headers, cookie: userA.cookie }, body: "{}" });
response = await api("/api/auth/sign-in/email", { method: "POST", headers, body: JSON.stringify({ email: userA.email, password: userA.password }) });
const freshCookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
response = await api(`/api/inbox/conversations/${conversationId}`, { headers: { cookie: freshCookie } });
payload = await response.json();
const messages = payload.conversation?.messages ?? [];
record("relogin_persistence", "200 with inbound and draft", `${response.status}/${messages.length}`, response.status === 200 && messages.some((message) => message.status === "received") && messages.some((message) => message.status === "draft"));

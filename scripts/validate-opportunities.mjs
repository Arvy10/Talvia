import { writeFile } from "node:fs/promises";

const base = "http://127.0.0.1:3000";
const headers = { origin: base, "content-type": "application/json" };
const suffix = Date.now();
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name} ${detail}`);
}

async function api(path, options = {}) {
  return fetch(`${base}${path}`, options);
}

async function createUser(label) {
  const email = `validation-${label}-${suffix}@example.test`;
  const password = "Test-password-2026!";
  const signup = await api("/api/auth/sign-up/email", { method: "POST", headers, body: JSON.stringify({ name: `Validation ${label}`, email, password }) });
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const provision = await api("/api/workspace/provision", { method: "POST", headers: { origin: base, cookie } });
  record(`user_${label}_provision`, signup.status === 200 && provision.status === 200, `${signup.status}/${provision.status}`);
  return { email, password, cookie };
}

const A = await createUser("a");
const B = await createUser("b");
const contactResponse = await api("/api/contacts", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ name: "Contact A validation", email: `contact-${suffix}@example.test`, status: "new" }) });
const contact = (await contactResponse.json()).contact;
const creation = await api("/api/opportunities", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ title: "Opportunity A", contactId: contact.id, stage: "new", value: 1000, currency: "EUR", nextAction: "Relancer", nextActionAt: "2026-09-01" }) });
const opportunity = (await creation.json()).opportunity;
record("create_opportunity", creation.status === 201, String(creation.status));

const readB = await api(`/api/opportunities/${opportunity.id}`, { headers: { cookie: B.cookie } });
record("cross_workspace_read", readB.status === 404, String(readB.status));
const updateB = await api(`/api/opportunities/${opportunity.id}`, { method: "PATCH", headers: { ...headers, cookie: B.cookie }, body: JSON.stringify({ title: "Intrusion", contactId: contact.id, stage: "new" }) });
record("cross_workspace_update", updateB.status === 404, String(updateB.status));
const stageB = await api(`/api/opportunities/${opportunity.id}`, { method: "PATCH", headers: { ...headers, cookie: B.cookie }, body: JSON.stringify({ title: "Intrusion", contactId: contact.id, stage: "qualified" }) });
record("cross_workspace_stage", stageB.status === 404, String(stageB.status));
const foreignContact = await api("/api/opportunities", { method: "POST", headers: { ...headers, cookie: B.cookie }, body: JSON.stringify({ title: "Contact interdit", contactId: contact.id, stage: "new" }) });
record("foreign_contact_create", foreignContact.status >= 400, String(foreignContact.status));

const second = await api("/api/opportunities", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ title: "Opportunity A bis", contactId: contact.id, stage: "new" }) });
record("multiple_opportunities_same_contact", second.status === 201, String(second.status));
const actionSource = await api("/api/opportunities", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ title: "Action à terminer", contactId: contact.id, stage: "new" }) });
const actionId = (await actionSource.json()).opportunity.id;
const completedAction = await api(`/api/opportunities/${actionId}`, { method: "PATCH", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ title: "Action à terminer", contactId: contact.id, stage: "qualified", nextAction: "Appeler le contact", nextActionAt: "2026-09-02", nextActionCompletedAt: "2026-09-01T09:00:00.000Z" }) });
record("complete_next_action", completedAction.status === 200, String(completedAction.status));
const note = await api(`/api/opportunities/${opportunity.id}/notes`, { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ body: "Note de validation persistante" }) });
record("create_note", note.status === 201, String(note.status));
const won = await api(`/api/opportunities/${opportunity.id}`, { method: "PATCH", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ closeAs: "won", finalValue: 1200 }) });
const wonBody = (await won.json()).opportunity;
record("won_persistence", won.status === 200 && wonBody.closedAt && wonBody.finalValue === 1200, String(won.status));
const lostSource = await api("/api/opportunities", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ title: "Opportunity perdue", contactId: contact.id, stage: "new" }) });
const lostId = (await lostSource.json()).opportunity.id;
const lost = await api(`/api/opportunities/${lostId}`, { method: "PATCH", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ closeAs: "lost", lostReason: "competitor" }) });
const lostBody = (await lost.json()).opportunity;
record("lost_persistence", lost.status === 200 && lostBody.closedAt && lostBody.lostReason === "competitor", String(lost.status));

const logout = await api("/api/auth/sign-out", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: "{}" });
const login = await api("/api/auth/sign-in/email", { method: "POST", headers, body: JSON.stringify({ email: A.email, password: A.password }) });
const renewedCookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
const afterLogin = await api(`/api/opportunities/${opportunity.id}`, { headers: { cookie: renewedCookie } });
const afterLoginBody = (await afterLogin.json()).opportunity;
const actionAfterLogin = await api(`/api/opportunities/${actionId}`, { headers: { cookie: renewedCookie } });
const actionAfterLoginBody = (await actionAfterLogin.json()).opportunity;
const lostAfterLogin = await api(`/api/opportunities/${lostId}`, { headers: { cookie: renewedCookie } });
const lostAfterLoginBody = (await lostAfterLogin.json()).opportunity;
const notes = await api(`/api/opportunities/${opportunity.id}/notes`, { headers: { cookie: renewedCookie } });
const noteCount = (await notes.json()).notes.length;
record("relogin_persistence", logout.status === 200 && login.status === 200 && afterLogin.status === 200 && afterLoginBody.status === "won" && afterLoginBody.closedAt && afterLoginBody.finalValue === 1200 && lostAfterLogin.status === 200 && lostAfterLoginBody.status === "lost" && lostAfterLoginBody.closedAt && lostAfterLoginBody.lostReason === "competitor", `${logout.status}/${login.status}/${afterLogin.status}/${lostAfterLogin.status}`);
record("next_action_after_relogin", actionAfterLogin.status === 200 && actionAfterLoginBody.nextAction === "Appeler le contact" && actionAfterLoginBody.nextActionAt && actionAfterLoginBody.nextActionCompletedAt, String(actionAfterLogin.status));
record("notes_after_relogin", noteCount > 0, String(noteCount));

await writeFile("validation/opportunities-validation.json", JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;

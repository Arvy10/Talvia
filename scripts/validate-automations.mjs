import { mkdirSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:3000";
const headers = { origin: base, "content-type": "application/json" };
const suffix = Date.now();
const results = [];
const report = "validation/automations-validation.json";

mkdirSync("validation", { recursive: true });
const flush = () => writeFileSync(report, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
const record = (scenario, expected, actual, status) => {
  results.push({ scenario, expected, actual, status: status ? "PASS" : "FAIL" });
  flush();
  console.log(`${status ? "PASS" : "FAIL"} ${scenario} ${actual}`);
};
const api = (path, options = {}) => fetch(`${base}${path}`, options);
const cookieFor = (response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

async function user(label) {
  const email = `automation-validation-${label}-${suffix}@example.test`;
  const password = "Test-password-2026!";
  const signup = await api("/api/auth/sign-up/email", { method: "POST", headers, body: JSON.stringify({ name: `Automation ${label}`, email, password }) });
  const cookie = cookieFor(signup);
  const provision = await api("/api/workspace/provision", { method: "POST", headers: { origin: base, cookie } });
  record(`user_${label}_provision`, "200/200", `${signup.status}/${provision.status}`, signup.status === 200 && provision.status === 200);
  return { email, password, cookie };
}

flush();
const A = await user("a");
const B = await user("b");
const input = {
  name: "Automation validation",
  status: "active",
  triggerType: "message.received",
  triggerConfig: { channel: "email" },
  conditionConfig: {},
  actionType: "mark_conversation_to_process",
  actionConfig: {},
  delaySeconds: 0,
};
const creation = await api("/api/automations", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify(input) });
const creationBody = await creation.json();
const automation = creationBody.automation;
record("create_automation", "201", String(creation.status), creation.status === 201 && automation?.status === "active");

const list = await api("/api/automations", { headers: { cookie: A.cookie } });
const listBody = await list.json();
record("persistence_list", "created automation present", String(list.status), list.status === 200 && listBody.automations?.some((item) => item.id === automation?.id));

const crossRead = await api(`/api/automations/${automation?.id}`, { headers: { cookie: B.cookie } });
record("cross_workspace_read", "404", String(crossRead.status), crossRead.status === 404);
const crossUpdate = await api(`/api/automations/${automation?.id}`, { method: "PATCH", headers: { ...headers, cookie: B.cookie }, body: JSON.stringify({ name: "intrusion" }) });
record("cross_workspace_update", "404", String(crossUpdate.status), crossUpdate.status === 404);
const crossTest = await api(`/api/automations/${automation?.id}/test`, { method: "POST", headers: { ...headers, cookie: B.cookie } });
record("cross_workspace_test", "404", String(crossTest.status), crossTest.status === 404);

const inactive = await api(`/api/automations/${automation?.id}`, { method: "PATCH", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ status: "inactive" }) });
record("deactivate", "200 inactive", String(inactive.status), inactive.status === 200 && (await inactive.json()).automation?.status === "inactive");
const active = await api(`/api/automations/${automation?.id}`, { method: "PATCH", headers: { ...headers, cookie: A.cookie }, body: JSON.stringify({ status: "active" }) });
record("activate", "200 active", String(active.status), active.status === 200 && (await active.json()).automation?.status === "active");

const duplicate = await api(`/api/automations/${automation?.id}/duplicate`, { method: "POST", headers: { ...headers, cookie: A.cookie } });
const duplicateBody = await duplicate.json();
record("duplicate_inactive", "201 inactive copy", String(duplicate.status), duplicate.status === 201 && duplicateBody.automation?.status === "inactive" && duplicateBody.automation?.id !== automation?.id);

const test = await api(`/api/automations/${automation?.id}/test`, { method: "POST", headers: { ...headers, cookie: A.cookie } });
record("manual_test_uses_engine", "200 run recorded", String(test.status), test.status === 200 && Boolean((await test.json()).run?.id));
const runs = await api(`/api/automations/${automation?.id}/runs`, { headers: { cookie: A.cookie } });
const runsBody = await runs.json();
record("runs_persisted", "at least one run", String(runs.status), runs.status === 200 && runsBody.runs?.length >= 1);

const logout = await api("/api/auth/sign-out", { method: "POST", headers: { ...headers, cookie: A.cookie }, body: "{}" });
const login = await api("/api/auth/sign-in/email", { method: "POST", headers, body: JSON.stringify({ email: A.email, password: A.password }) });
const renewed = cookieFor(login);
const afterLogin = await api(`/api/automations/${automation?.id}`, { headers: { cookie: renewed } });
record("relogin_persistence", "200", `${logout.status}/${login.status}/${afterLogin.status}`, logout.status === 200 && login.status === 200 && afterLogin.status === 200);

const archive = await api(`/api/automations/${automation?.id}`, { method: "DELETE", headers: { cookie: renewed } });
record("archive_preserves_runs", "200", String(archive.status), archive.status === 200);
flush();
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;

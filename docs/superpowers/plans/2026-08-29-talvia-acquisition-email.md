# Talvia Acquisition Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Capture opt-in beta leads, send an idempotent Resend sequence, and retain attribution without touching the customer CRM.

**Architecture:** Global Neon tables store Talvia acquisition leads, email deliveries and provider events. Public endpoints capture and unsubscribe; an authenticated cron endpoint atomically claims deliveries; a separate signed Resend webhook records outcomes. The existing Brevo auth mailer is untouched.

**Tech Stack:** Next.js 16, TypeScript, PostgreSQL/Neon through \`pg\`, Vitest, Resend REST API.

**Spec:** \`docs/superpowers/specs/2026-08-29-talvia-acquisition-email-design.md\`

## Global Constraints

- Do not alter Inbox, conversations, messages, Unipile, LinkedIn, WhatsApp, Gmail-provider, or Unipile webhook files.
- Do not use workspace-scoped \`contacts\`, Campaigns, or Automations tables.
- No Supabase, queue vendor, admin dashboard, CSV UI, scraping or cold email.
- Keep \`app/lib/email.ts\` and Brevo environment variables unchanged.
- Parameterize every query and make all registration, delivery, unsubscribe and webhook operations idempotent.

---

### Task 1: Create the acquisition data contract

**Files:**
- Create: \`db/migrations/013_acquisition_email.sql\`
- Create: \`app/lib/acquisition/acquisition-schema.test.ts\`
- Modify: \`.env.example\`

**Interfaces:** Creates global \`beta_leads\`, \`acquisition_email_deliveries\`, and \`acquisition_email_events\` tables; documents the Resend/server secret variables.

- [ ] **Step 1: Write the failing migration contract test**

\`\`\`ts
import migration from "../../../db/migrations/013_acquisition_email.sql?raw";

test("isolates acquisition data and enforces idempotence", () => {
  expect(migration).toContain("create table beta_leads");
  expect(migration).toContain("unique(email_normalized)");
  expect(migration).toContain("unique(lead_id,email_type)");
  expect(migration).toContain("unique(provider_event_id)");
});
\`\`\`

- [ ] **Step 2: Run the test**

Run: \`npm test -- app/lib/acquisition/acquisition-schema.test.ts\`

Expected: FAIL because migration 013 does not exist.

- [ ] **Step 3: Add the migration and env entries**

\`\`\`sql
create table beta_leads (
  id uuid primary key default gen_random_uuid(), email text not null,
  email_normalized text not null unique, first_name text, role text,
  status varchar(16) not null default 'WAITLIST'
    check (status in ('WAITLIST','INVITED','ACTIVATED','CUSTOMER','UNSUBSCRIBED')),
  consent_at timestamptz not null, unsubscribed_at timestamptz,
  source text, utm_source text, utm_medium text, utm_campaign text,
  utm_content text, utm_term text, landing_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
\`\`\`

Add deliveries with unique \`(lead_id,email_type)\`, status check \`pending|sending|sent|failed|skipped|cancelled\`, attempt/error/provider fields, and events with unique \`provider_event_id\`. Document \`RESEND_API_KEY\`, \`RESEND_EMAIL_FROM\`, \`RESEND_EMAIL_REPLY_TO\`, \`APP_URL\`, \`ACQUISITION_SCHEDULER_SECRET\`, \`RESEND_WEBHOOK_SECRET\`, and \`ACQUISITION_UNSUBSCRIBE_SECRET\` in \`.env.example\`.

- [ ] **Step 4: Verify GREEN and commit**

Run: \`npm test -- app/lib/acquisition/acquisition-schema.test.ts\`

Expected: PASS. Commit: \`feat: add acquisition email schema\`.

### Task 2: Register leads and queue their starting sequence

**Files:**
- Create: \`app/lib/acquisition/types.ts\`
- Create: \`app/lib/acquisition/leads.ts\`
- Create: \`app/lib/acquisition/leads.test.ts\`

**Interfaces:** Produces \`normalizeAcquisitionEmail(value)\`, \`registerBetaLead(input): Promise<{created:boolean; leadId:string}>\`, and \`unsubscribeBetaLead(leadId)\`.

- [ ] **Step 1: Write failing behavior tests**

\`\`\`ts
test("stores normalized e-mail, attribution and the initial three deliveries", async () => {
  const result = await registerBetaLead({ email: " Ada@Example.COM ", firstName: "Ada", utmSource: "linkedin" });
  expect(result.created).toBe(true);
  expect(store.leads[0]).toMatchObject({ email_normalized: "ada@example.com", status: "WAITLIST", utm_source: "linkedin" });
  expect(store.deliveries.map((d) => d.email_type)).toEqual(["welcome", "day_1", "day_3"]);
});
test("rejects malformed e-mail before database writes", async () => {
  await expect(registerBetaLead({ email: "invalid" })).rejects.toThrow("adresse e-mail valide");
});
test("does not overwrite an existing lead or enqueue duplicate deliveries", async () => {
  await registerBetaLead({ email: "ada@example.com", utmSource: "linkedin" });
  expect((await registerBetaLead({ email: "ADA@example.com", utmSource: "x" })).created).toBe(false);
  expect(store.leads).toHaveLength(1); expect(store.deliveries).toHaveLength(3);
});
\`\`\`

- [ ] **Step 2: Run the test**

Run: \`npm test -- app/lib/acquisition/leads.test.ts\`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the transactional service**

\`\`\`ts
export function normalizeAcquisitionEmail(value: string) { return value.trim().toLowerCase(); }
export async function registerBetaLead(input: LeadRegistrationInput) {
  const normalized = validateLeadInput(input); const client = await database.connect();
  try { await client.query("begin");
    const exists = await client.query<{id:string}>("select id from beta_leads where email_normalized=$1", [normalized.email]);
    if (exists.rows[0]) { await client.query("commit"); return { created:false, leadId:exists.rows[0].id }; }
    const inserted = await client.query<{id:string}>("insert into beta_leads (...) values (...) returning id", [...]);
    await client.query("insert into acquisition_email_deliveries (...) values (...),(...),(...) on conflict (lead_id,email_type) do nothing", [...]);
    await client.query("commit"); return { created:true, leadId:inserted.rows[0].id };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
\`\`\`

Validate first name/role lengths, valid e-mail shape, and accepted UTM strings. Preserve original consent and attribution for duplicates. Queue welcome now, J+1 and J+3 in the same transaction. Implement unsubscription as one transaction that marks the lead \`UNSUBSCRIBED\`, timestamps it, and cancels pending/failed deliveries.

- [ ] **Step 4: Verify GREEN and commit**

Run: \`npm test -- app/lib/acquisition/leads.test.ts\`

Expected: PASS. Commit: \`feat: register beta leads idempotently\`.

### Task 3: Implement public capture UI and API

**Files:**
- Create: \`app/api/acquisition/beta/route.ts\`
- Create: \`app/beta/page.tsx\`
- Create: \`app/beta/BetaSignupForm.tsx\`
- Create: \`app/beta/beta-signup-form.test.tsx\`
- Modify: \`app/page.tsx\`
- Modify: \`app/components/LandingSections.tsx\`

**Interfaces:** Produces \`POST /api/acquisition/beta\` and \`/beta\`; consumes \`registerBetaLead\`.

- [ ] **Step 1: Write failing route and UI tests**

\`\`\`ts
test("returns a neutral registration result", async () => {
  const response = await POST(new Request("http://localhost/api/acquisition/beta", { method:"POST", body:JSON.stringify({email:"ada@example.com"}) }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok:true, alreadyRegistered:false });
});
test("forwards allowed UTM values and shows confirmation", async () => {
  render(<BetaSignupForm search="?utm_source=linkedin&utm_campaign=beta" />);
  await userEvent.type(screen.getByLabelText("E-mail"), "ada@example.com");
  await userEvent.click(screen.getByRole("button", { name:"Tester Talvia" }));
  expect(fetch).toHaveBeenCalledWith("/api/acquisition/beta", expect.objectContaining({method:"POST"}));
  expect(await screen.findByText(/inscription est enregistrée/i)).toBeVisible();
});
\`\`\`

- [ ] **Step 2: Run the test**

Run: \`npm test -- app/beta/beta-signup-form.test.tsx\`

Expected: FAIL because the page and route are absent.

- [ ] **Step 3: Implement the route and accessible form**

\`\`\`ts
export async function POST(request: Request) {
  try { const result = await registerBetaLead(await request.json());
    return NextResponse.json({ ok:true, alreadyRegistered:!result.created }, { status:result.created ? 201 : 200 });
  } catch { return NextResponse.json({ error:"Saisissez une adresse e-mail valide." }, { status:400 }); }
}
\`\`\`

Render only Prénom, E-mail, and Activité/rôle (optional). Use \`URLSearchParams\` only for approved UTM names plus \`window.location.href\`. Point beta-oriented public landing CTAs to \`/beta\`. Show the same confirmation after a duplicate response.

- [ ] **Step 4: Verify GREEN and commit**

Run: \`npm test -- app/beta/beta-signup-form.test.tsx\`

Expected: PASS. Commit: \`feat: add public Talvia beta signup\`.

### Task 4: Add Resend, unsubscribe token, and scheduler

**Files:**
- Create: \`app/lib/acquisition/resend.ts\`
- Create: \`app/lib/acquisition/templates.ts\`
- Create: \`app/lib/acquisition/unsubscribe.ts\`
- Create: \`app/lib/acquisition/scheduler.ts\`
- Create: \`app/lib/acquisition/scheduler.test.ts\`
- Create: \`app/api/acquisition/unsubscribe/route.ts\`
- Create: \`app/api/acquisition/scheduler/route.ts\`

**Interfaces:** Produces \`sendAcquisitionEmail\`, \`createUnsubscribeToken\`, \`verifyUnsubscribeToken\`, and \`runAcquisitionScheduler\`.

- [ ] **Step 1: Write failing delivery and idempotence tests**

\`\`\`ts
test("sends through Resend with reply-to and unsubscribe link", async () => {
  await sendAcquisitionEmail({ to:"ada@example.com", subject:"Bienvenue", text:"Bonjour", html:"<p>Bonjour</p>", unsubscribeUrl:"https://app.test/u?t=x" });
  expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({headers:expect.objectContaining({Authorization:"Bearer test-key"})}));
});
test("unsubscribing cancels pending emails", async () => {
  await unsubscribeBetaLead("lead-1"); expect(store.lead.status).toBe("UNSUBSCRIBED");
  expect(store.pending.every((d) => d.status === "cancelled")).toBe(true);
});
test("two scheduler invocations send a due delivery only once", async () => {
  const [a,b] = await Promise.all([runAcquisitionScheduler(), runAcquisitionScheduler()]);
  expect(a.sent + b.sent).toBe(1);
});
\`\`\`

- [ ] **Step 2: Run the test**

Run: \`npm test -- app/lib/acquisition/scheduler.test.ts\`

Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement delivery and claim-send-finalize**

\`\`\`ts
const claimed = await client.query(\`with due as (
  select d.id from acquisition_email_deliveries d join beta_leads l on l.id=d.lead_id
  where d.status in ('pending','failed') and d.scheduled_at<=now() and l.status<>'UNSUBSCRIBED'
  order by d.scheduled_at for update of d skip locked limit $1
) update acquisition_email_deliveries d set status='sending',attempt_count=d.attempt_count+1,updated_at=now()
from due where d.id=due.id returning d.*\`, [limit]);
\`\`\`

Call \`https://api.resend.com/emails\` with only server environment values. Persist its returned provider id; mark provider errors \`failed\`; never re-claim \`sent\`. Generate HMAC-SHA256 unsubscribe tokens from \`ACQUISITION_UNSUBSCRIBE_SECRET\`; include a List-Unsubscribe header and link in the simple responsive welcome/J+1/J+3/beta-access templates. Require \`Authorization: Bearer <secret>\` and \`crypto.timingSafeEqual\` for the scheduler route.

- [ ] **Step 4: Verify GREEN and commit**

Run: \`npm test -- app/lib/acquisition/scheduler.test.ts\`

Expected: PASS. Commit: \`feat: send opted-in acquisition email sequence\`.

### Task 5: Add signed Resend webhook and operational guide

**Files:**
- Create: \`app/lib/acquisition/webhook.ts\`
- Create: \`app/lib/acquisition/webhook.test.ts\`
- Create: \`app/api/webhooks/resend/route.ts\`
- Create: \`app/lib/acquisition/acquisition-documentation.test.ts\`
- Modify: \`README.md\`

**Interfaces:** Produces \`verifyResendWebhook(rawBody, headers)\`, \`ingestResendEvent(event)\`, and a separately signed webhook route.

- [ ] **Step 1: Write failing webhook and documentation tests**

\`\`\`ts
test("rejects unsigned webhook requests", async () => {
  const response = await POST(new Request("http://localhost/api/webhooks/resend", {method:"POST",body:"{}"}));
  expect(response.status).toBe(401);
});
test("records an event once and ignores replay", async () => {
  const event = signedEvent({id:"evt-1",type:"email.delivered",data:{email_id:"msg-1"}});
  expect(await ingestResendEvent(event)).toBe("processed");
  expect(await ingestResendEvent(event)).toBe("duplicate");
});
test("README explains webhook operation", async () => {
  expect(await readFile("README.md","utf8")).toContain("/api/webhooks/resend");
});
\`\`\`

- [ ] **Step 2: Run the test**

Run: \`npm test -- app/lib/acquisition/webhook.test.ts app/lib/acquisition/acquisition-documentation.test.ts\`

Expected: FAIL because webhook and guide are absent.

- [ ] **Step 3: Implement signature verification, idempotence and instructions**

\`\`\`ts
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyResendWebhook(rawBody, request.headers)) return NextResponse.json({error:"Non autorisé."},{status:401});
  const result = await ingestResendEvent(JSON.parse(rawBody));
  return NextResponse.json({ok:true,duplicate:result==="duplicate"});
}
\`\`\`

Verify Resend's documented Svix headers with \`RESEND_WEBHOOK_SECRET\`. Insert an event with \`on conflict (provider_event_id) do nothing\`; use \`data.email_id\` only to update the matching delivery's useful delivery/failure state. Document: verified Resend sending domain; all variables; applying migration 013; webhook URL and signing secret; cron POST to \`APP_URL/api/acquisition/scheduler\` with its Bearer secret.

- [ ] **Step 4: Run all verification commands**

Run: \`npm test && npm run lint && npx tsc --noEmit && npm run build\`

Expected: PASS. Report unrelated existing failures but do not resolve them by touching excluded Inbox files.

- [ ] **Step 5: Commit**

Commit files from this task with: \`feat: record Resend acquisition events\`.

## Plan self-review

- Coverage: schema/config (task 1), validation/UTM/deduplication (task 2), public page (task 3), welcome/J+1/J+3, unsubscribe and scheduler (task 4), signed webhook and exact operation (task 5).
- Scope: no workspace CRM table, Inbox component, Unipile file, dashboard, import UI, billing, scraping, or cold-email function changes.
- Consistency: each route consumes a named acquisition interface, all persistence uses migration 013, and Resend is isolated from Brevo.

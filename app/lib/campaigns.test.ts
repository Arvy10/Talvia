import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "./workspace-context";

// Fake DB by SQL prefix — same approach as
// campaign-execution/step-progression.test.ts and
// providers/unipile-adapter.test.ts. Covers campaigns/campaign_steps/
// campaign_participants/contacts/companies/contact_identities/activities,
// enough to exercise createCampaign/transitionCampaign/addParticipants end
// to end, including the new current_step_id initialization they now trigger
// via step-progression.ts's real (unmocked) advanceParticipantToNextStep.
// Mirrors conversation-resolution.ts's own tie-break exactly: primary key
// coalesce(last_message_at,created_at) desc, then created_at desc, then id
// desc as a final, always-unique tie-break. Shared by both the
// listEligibleWhatsAppRelations fake handler and the findConversationId fake
// handler below so a cross-check test comparing their two results is
// actually meaningful — not just two independently-plausible fakes.
function pickCanonicalConversation(candidates: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  return [...candidates].sort((a, b) => {
    const aKey = (a.last_message_at as string | null) ?? (a.created_at as string);
    const bKey = (b.last_message_at as string | null) ?? (b.created_at as string);
    if (aKey !== bKey) return aKey < bKey ? 1 : -1;
    const aCreated = a.created_at as string, bCreated = b.created_at as string;
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    const aId = a.id as string, bId = b.id as string;
    return aId < bId ? 1 : -1;
  })[0];
}
function pickLastNonDraftMessage(messages: Array<Record<string, unknown>>, conversationId: string): Record<string, unknown> | undefined {
  const candidates = messages.filter((m) => m.conversation_id === conversationId && m.status !== "draft");
  return [...candidates].sort((a, b) => ((a.effective_time as string) < (b.effective_time as string) ? 1 : -1))[0];
}

function createFakeDatabase() {
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const companies: Array<Record<string, unknown>> = [];
  const contactIdentities: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  const transactionLog: string[] = [];
  // Call counters proving the N+1 fix: hasCompatibleIdentity's own query vs
  // eligibleWhatsAppContactIds' single bulk query, counted separately so a
  // test can assert "one bulk call, zero per-contact calls" for WhatsApp
  // without needing a generic query log.
  let identityCheckCalls = 0;
  let bulkEligibilityCalls = 0;
  // Configurable failure trigger for the atomicity test — set via the
  // returned object's setter BEFORE calling transitionCampaign. Deliberately
  // internal to this closure rather than a reassignable `fakeDatabase.query`
  // property: transitionCampaign does all its writes through one
  // database.connect()-obtained client, whose own `query` reference is
  // captured once at connect() time — reassigning the exported `.query`
  // property afterward (the pattern used elsewhere for direct
  // database.query() calls) would never be seen by that already-bound
  // client.
  let failInitializationOnCallNumber: number | null = null;
  let initializationCallCount = 0;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin" || text === "commit" || text === "rollback") { transactionLog.push(text); return { rows: [] }; }

    if (text.startsWith("insert into campaigns(workspace_id,name,objective,channel_type,status,created_by_user_id,settings)")) {
      const [workspaceId, name, objective, channelType, createdByUserId, settings] = params as [string, string, string, string, string, unknown];
      const row = { id: nextId("camp"), workspace_id: workspaceId, name, objective, channel_type: channelType, status: "draft", created_by_user_id: createdByUserId, settings, started_at: null, paused_at: null, completed_at: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      campaigns.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("insert into campaign_steps(campaign_id,position,step_type,channel_type,delay_value,delay_unit,message_template)")) {
      const [campaignId, position, stepType, channelType, delayValue, delayUnit, messageTemplate] = params as [string, number, string, string | null, number, string, string | null];
      campaignSteps.push({ id: nextId("step"), campaign_id: campaignId, position, step_type: stepType, channel_type: channelType, delay_value: delayValue, delay_unit: delayUnit, message_template: messageTemplate });
      return { rows: [] };
    }

    // createCampaign's own participant insert — always literal 'waiting',
    // no `returning` (distinct text from addParticipants' own insert below).
    if (text.startsWith("insert into campaign_participants(campaign_id,contact_id,status) values($1,$2,'waiting')")) {
      const [campaignId, contactId] = params as [string, string];
      campaignParticipants.push({ id: nextId("part"), campaign_id: campaignId, contact_id: contactId, status: "waiting", current_step_id: null, started_at: null, replied_at: null, stopped_at: null, stop_reason: null, step_claimed_at: null, last_action_at: null });
      return { rows: [] };
    }

    // addParticipants' own insert — idempotent via ON CONFLICT DO NOTHING,
    // and `returning id` is what lets campaigns.ts distinguish a genuinely
    // new row from a no-op conflict (only a fresh row is ever initialized).
    if (text.startsWith("insert into campaign_participants(campaign_id,contact_id,status) values($1,$2,$3) on conflict(campaign_id,contact_id) do nothing returning id")) {
      const [campaignId, contactId, status] = params as [string, string, string];
      if (campaignParticipants.some((p) => p.campaign_id === campaignId && p.contact_id === contactId)) return { rows: [] };
      const row = { id: nextId("part"), campaign_id: campaignId, contact_id: contactId, status, current_step_id: null, started_at: null, replied_at: null, stopped_at: null, stop_reason: null, step_claimed_at: null, last_action_at: null };
      campaignParticipants.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("select c.id from contacts c join contact_identities ci on ci.contact_id=c.id and ci.workspace_id=c.workspace_id")) {
      identityCheckCalls += 1;
      const [workspaceId, contactId, channelType] = params as [string, string, string];
      const contact = contacts.find((c) => c.workspace_id === workspaceId && c.id === contactId && !c.archived_at);
      const hasIdentity = contact && contactIdentities.some((ci) => ci.workspace_id === workspaceId && ci.contact_id === contactId && ci.channel_type === channelType);
      return { rows: hasIdentity ? [{ id: contactId }] : [] };
    }

    // eligibleWhatsAppContactIds — the bulk guard: both identity AND a real
    // Conversation, checked for a whole batch of contactIds in one query.
    if (text.startsWith("select distinct c.id from contacts c where c.workspace_id=$1 and c.id = any($2::uuid[]) and c.archived_at is null")) {
      bulkEligibilityCalls += 1;
      const [workspaceId, contactIds] = params as [string, string[]];
      const eligible = contacts.filter((c) =>
        c.workspace_id === workspaceId
        && contactIds.includes(c.id as string)
        && !c.archived_at
        && contactIdentities.some((ci) => ci.workspace_id === workspaceId && ci.contact_id === c.id && ci.channel_type === "whatsapp")
        && conversations.some((v) => v.workspace_id === workspaceId && v.contact_id === c.id && v.channel_type === "whatsapp"),
      );
      return { rows: eligible.map((c) => ({ id: c.id })) };
    }

    // listEligibleWhatsAppRelations — the audience listing itself. Mirrors
    // the real query's semantics precisely: an INNER lateral pick of the
    // canonical Conversation (a Contact with no eligible Conversation is
    // excluded entirely, exactly like a real INNER LATERAL JOIN would), a
    // LEFT lateral pick of the latest non-draft message for the preview,
    // and the identity existence check as a separate, explicit condition.
    if (text.startsWith("select c.id contact_id, c.display_name, co.name company, v.id conversation_id, v.last_message_at, lm.body last_message_body, lm.direction last_message_direction")) {
      const [workspaceId] = params as [string];
      const eligibleContacts = contacts.filter((c) =>
        c.workspace_id === workspaceId
        && !c.archived_at
        && contactIdentities.some((ci) => ci.workspace_id === workspaceId && ci.contact_id === c.id && ci.channel_type === "whatsapp"),
      );
      const rows = eligibleContacts
        .map((c) => {
          const candidates = conversations.filter((v) => v.workspace_id === workspaceId && v.contact_id === c.id && v.channel_type === "whatsapp");
          const canonical = pickCanonicalConversation(candidates);
          if (!canonical) return null; // no eligible Conversation -> excluded, same as a real INNER LATERAL JOIN
          const lastMessage = pickLastNonDraftMessage(messages, canonical.id as string);
          const company = companies.find((co) => co.id === c.company_id && co.workspace_id === workspaceId);
          return {
            contact_id: c.id, display_name: c.display_name, company: company?.name ?? null,
            conversation_id: canonical.id, last_message_at: canonical.last_message_at ?? null,
            last_message_body: lastMessage?.body ?? null, last_message_direction: lastMessage?.direction ?? null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => {
          if (a.last_message_at !== b.last_message_at) {
            if (a.last_message_at === null) return 1; // nulls last
            if (b.last_message_at === null) return -1;
            return a.last_message_at < b.last_message_at ? 1 : -1;
          }
          return (a.display_name as string).localeCompare(b.display_name as string);
        });
      return { rows };
    }

    // conversation-resolution.ts's own findConversationId — reused directly
    // (not re-derived) so the cross-check test below compares the REAL
    // function's output, not a second independent fake of it.
    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2 and channel_type=$3")) {
      const [workspaceId, contactId, channelType] = params as [string, string, string];
      const candidates = conversations.filter((v) => v.workspace_id === workspaceId && v.contact_id === contactId && v.channel_type === channelType);
      const canonical = pickCanonicalConversation(candidates);
      return { rows: canonical ? [{ id: canonical.id }] : [] };
    }

    if (text.startsWith("select c.id,c.name,c.objective,c.channel_type,c.status,c.settings,c.started_at,c.paused_at,c.completed_at,c.archived_at,c.created_at,c.updated_at,count(p.id) participant_count from campaigns c")) {
      const [workspaceId, campaignId] = params as [string, string];
      const row = campaigns.find((c) => c.workspace_id === workspaceId && c.id === campaignId);
      if (!row) return { rows: [] };
      const count = campaignParticipants.filter((p) => p.campaign_id === campaignId).length;
      return { rows: [{ ...row, participant_count: String(count) }] };
    }

    if (text.startsWith("select id,position,step_type,channel_type,delay_value,delay_unit,message_template from campaign_steps where campaign_id=$1 order by position asc")) {
      const [campaignId] = params as [string];
      const rows = campaignSteps.filter((s) => s.campaign_id === campaignId).sort((a, b) => (a.position as number) - (b.position as number));
      return { rows };
    }

    if (text.startsWith("select p.id,p.contact_id,c.display_name,co.name company,p.status,p.current_step_id,p.started_at,p.replied_at,p.stopped_at,p.stop_reason from campaign_participants p")) {
      const [workspaceId, campaignId] = params as [string, string];
      const rows = campaignParticipants
        .filter((p) => p.campaign_id === campaignId)
        .map((p) => {
          const contact = contacts.find((c) => c.id === p.contact_id && c.workspace_id === workspaceId);
          const company = contact ? companies.find((co) => co.id === contact.company_id && co.workspace_id === workspaceId) : undefined;
          return { id: p.id, contact_id: p.contact_id, display_name: contact?.display_name ?? "Inconnu", company: company?.name ?? null, status: p.status, current_step_id: p.current_step_id, started_at: p.started_at, replied_at: p.replied_at, stopped_at: p.stopped_at, stop_reason: p.stop_reason };
        });
      return { rows };
    }

    if (text.startsWith("update campaigns set status=$1,started_at=case")) {
      const [target, , workspaceId, campaignId] = params as [string, string, string, string];
      const row = campaigns.find((c) => c.workspace_id === workspaceId && c.id === campaignId);
      if (row) row.status = target;
      return { rows: [] };
    }

    // The corrected query — bulk-activates only genuinely 'waiting'
    // participants whose current_step_id is explicitly still null (not just
    // implied by status='waiting'), and RETURNS their ids so campaigns.ts
    // can initialize each one's current_step_id in the same transaction. A
    // participant already mid-sequence is structurally excluded by this
    // WHERE clause itself, not by an unstated convention elsewhere.
    // Mirrors the real activation guard: not-yet-started means
    // current_step_id NULL, or already parked on the campaign's FIRST step
    // (what a prospect approved while the campaign was a draft looks like on
    // rows written before prospecting.ts stopped stamping it).
    if (text.startsWith("update campaign_participants set status='active',started_at=coalesce(started_at,now()),updated_at=now() where campaign_id=$1 and status='waiting' and (current_step_id is null or current_step_id=(select id from campaign_steps where campaign_id=$1 order by position limit 1)) returning id")) {
      const [campaignId] = params as [string];
      const firstStepId = campaignSteps.filter((step) => step.campaign_id === campaignId).sort((a, b) => (a.position as number) - (b.position as number))[0]?.id;
      const matches = campaignParticipants.filter((p) => p.campaign_id === campaignId && p.status === "waiting" && (!p.current_step_id || p.current_step_id === firstStepId));
      for (const p of matches) { p.status = "active"; p.started_at = p.started_at ?? new Date().toISOString(); }
      return { rows: matches.map((p) => ({ id: p.id })) };
    }

    // eligibleEmailContactIds — the email bulk guard. Deliberately a
    // DIFFERENT rule from WhatsApp's: a usable address, never a Conversation.
    if (text.startsWith("select distinct c.id from contacts c join contact_identities ci on ci.contact_id=c.id and ci.workspace_id=c.workspace_id where c.workspace_id=$1 and c.id = any($2::uuid[])")) {
      bulkEligibilityCalls += 1;
      const [workspaceId, contactIds] = params as [string, string[]];
      const eligible = contacts.filter((c) =>
        c.workspace_id === workspaceId
        && contactIds.includes(c.id as string)
        && !c.archived_at
        && contactIdentities.some((ci) => ci.workspace_id === workspaceId && ci.contact_id === c.id && ci.channel_type === "email" && ci.identifier_normalized));
      return { rows: eligible.map((c) => ({ id: c.id })) };
    }

    // listEligibleEmailContacts
    if (text.startsWith("select c.id contact_id, c.display_name, co.name company, ident.identifier address")) {
      const [workspaceId] = params as [string];
      const rows = contacts
        .filter((c) => c.workspace_id === workspaceId && !c.archived_at)
        .map((c) => {
          const identity = contactIdentities
            .filter((ci) => ci.workspace_id === workspaceId && ci.contact_id === c.id && ci.channel_type === "email" && ci.identifier_normalized)
            .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0];
          if (!identity) return null;
          const conversation = pickCanonicalConversation(conversations.filter((v) => v.workspace_id === workspaceId && v.contact_id === c.id && v.channel_type === "email"));
          const company = companies.find((co) => co.id === c.company_id && co.workspace_id === workspaceId);
          return { contact_id: c.id, display_name: c.display_name, company: company?.name ?? null, address: identity.identifier, conversation_id: conversation?.id ?? null, last_message_at: conversation?.last_message_at ?? null };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      return { rows };
    }

    if (text.startsWith("insert into activities")) {
      const row = { id: nextId("activity") };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: new Date().toISOString() }] };
    }

    // --- step-progression.ts's own queries, reused unmocked (real
    // advanceParticipantToNextStep/initializeParticipantStep run against
    // this same fake) ---
    if (text.startsWith("select position from campaign_steps where campaign_id=$1 and id=$2")) {
      const [campaignId, stepId] = params as [string, string];
      const row = campaignSteps.find((s) => s.campaign_id === campaignId && s.id === stepId);
      return { rows: row ? [{ position: row.position }] : [] };
    }
    if (text.startsWith("select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and position>$2")) {
      const [campaignId, position] = params as [string, number];
      const row = campaignSteps.filter((s) => s.campaign_id === campaignId && (s.position as number) > Number(position)).sort((a, b) => (a.position as number) - (b.position as number))[0];
      return { rows: row ? [{ id: row.id, position: row.position, step_type: row.step_type, message_template: row.message_template ?? null }] : [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=coalesce($1,current_step_id),status='completed'")) {
      const [nextStepId, id] = params as [string | null, string];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId ?? row.current_step_id; row.status = "completed"; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=$1,step_claimed_at=null")) {
      initializationCallCount += 1;
      if (failInitializationOnCallNumber === initializationCallCount) throw new Error("simulated failure during initialization");
      const [nextStepId, id] = params as [string, string];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return {
    query, connect: async () => ({ query, release: () => {} }),
    campaigns, campaignSteps, campaignParticipants, contacts, companies, contactIdentities, conversations, messages, activities, transactionLog,
    setFailInitializationOnCallNumber: (n: number | null) => { failInitializationOnCallNumber = n; },
    get identityCheckCalls() { return identityCheckCalls; },
    get bulkEligibilityCalls() { return bulkEligibilityCalls; },
  };
}

let fakeDatabase = createFakeDatabase();
// conversation-resolution.ts imports "../database" (relative to
// lib/campaign-execution/) — resolves to the exact same lib/database.ts
// module as campaigns.ts's own "./database", so this one mock covers both;
// the cross-check test below imports findConversationId directly and runs
// it against this same fake.
vi.mock("./database", () => ({ get database() { return fakeDatabase; } }));

const { addParticipants, createCampaign, listEligibleEmailContacts, listEligibleWhatsAppRelations, transitionCampaign } = await import("./campaigns");
const { advanceParticipantToNextStep } = await import("./campaign-execution/step-progression");
const { findConversationId } = await import("./campaign-execution/conversation-resolution");

beforeEach(() => { fakeDatabase = createFakeDatabase(); });

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function seedContact(id: string, channelType: "whatsapp" | "linkedin" = "whatsapp") {
  fakeDatabase.contacts.push({ id, workspace_id: workspaceId, display_name: `Contact ${id}`, company_id: null, archived_at: null });
  fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: id, channel_type: channelType });
}

function seedConversation(id: string, contactId: string, opts: { channelType?: "whatsapp" | "linkedin"; lastMessageAt?: string | null; createdAt?: string; workspaceId?: string } = {}) {
  fakeDatabase.conversations.push({
    id, workspace_id: opts.workspaceId ?? workspaceId, contact_id: contactId, channel_type: opts.channelType ?? "whatsapp",
    last_message_at: opts.lastMessageAt ?? null, created_at: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
  });
}

function seedMessage(id: string, conversationId: string, opts: { body?: string; direction?: "inbound" | "outbound"; effectiveTime?: string; status?: string } = {}) {
  fakeDatabase.messages.push({
    id, conversation_id: conversationId, body: opts.body ?? "Bonjour", direction: opts.direction ?? "inbound",
    effective_time: opts.effectiveTime ?? "2026-01-01T00:00:00.000Z", status: opts.status ?? "received",
  });
}

// Convenience for tests that predate the Phase B eligibility guard (identity
// AND a real Conversation) and just need a WhatsApp relation that is
// unconditionally eligible — identity-only fixtures deliberately still use
// seedContact alone where a test's whole point is "no Conversation yet".
function seedWhatsAppRelation(contactId: string) {
  seedContact(contactId);
  seedConversation(`conv-${contactId}`, contactId, { lastMessageAt: "2026-01-01T00:00:00.000Z" });
}

// message(0) -> wait 3d(1) -> message "relance"(2) -> end(3) — the standard
// WhatsApp follow_up/reactivation shape built by the wizard.
async function createWhatsAppCampaign(objective: "follow_up" | "reactivation", contactIds: string[]) {
  return createCampaign(context, {
    name: `Campagne ${objective}`,
    objective,
    channelType: "whatsapp",
    participantIds: contactIds,
    steps: [
      { position: 0, stepType: "message", channelType: "whatsapp", messageTemplate: "Bonjour !" },
      { position: 1, stepType: "wait", delayValue: 3, delayUnit: "days" },
      { position: 2, stepType: "message", channelType: "whatsapp", messageTemplate: "Relance" },
      { position: 3, stepType: "end" },
    ],
  });
}

describe("current_step_id initialization — WhatsApp follow_up/reactivation", () => {
  it("1. follow_up: activation initializes the first participant's current_step_id, making it claimable", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "waiting", current_step_id: null });

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
    expect(participant.last_action_at).not.toBeNull();
  });

  it("2. reactivation: same guarantee as follow_up", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("reactivation", ["contact-1"]);

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
  });
});

describe("current_step_id initialization — addParticipants", () => {
  it("3. adding a contact to an already-active campaign initializes it immediately", async () => {
    seedWhatsAppRelation("contact-1");
    seedWhatsAppRelation("contact-2");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    await transitionCampaign(context, campaign.id, "activate");

    await addParticipants(context, campaign.id, ["contact-2"]);

    const newParticipant = fakeDatabase.campaignParticipants.find((p) => p.contact_id === "contact-2")!;
    expect(newParticipant.status).toBe("active");
    expect(newParticipant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
  });

  it("4a. adding a contact to a still-draft campaign leaves it waiting, current_step_id null", async () => {
    seedWhatsAppRelation("contact-1");
    seedWhatsAppRelation("contact-2");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]); // draft, never activated

    await addParticipants(context, campaign.id, ["contact-2"]);

    const newParticipant = fakeDatabase.campaignParticipants.find((p) => p.contact_id === "contact-2")!;
    expect(newParticipant.status).toBe("waiting");
    expect(newParticipant.current_step_id).toBeNull();
  });

  it("4b. ...and activating the campaign afterward initializes it then, not before", async () => {
    seedWhatsAppRelation("contact-1");
    seedWhatsAppRelation("contact-2");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    await addParticipants(context, campaign.id, ["contact-2"]);

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants.find((p) => p.contact_id === "contact-2")!;
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
  });
});

describe("current_step_id initialization — never re-initializes an already-advanced participant", () => {
  it("5. real progression (step_1 -> step_2 via advanceParticipantToNextStep) survives a pause/resume cycle unchanged — never reinitialized from scratch", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    await transitionCampaign(context, campaign.id, "activate");

    const firstStep = fakeDatabase.campaignSteps.find((s) => s.position === 0)!;
    const waitStep = fakeDatabase.campaignSteps.find((s) => s.position === 1)!;
    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.current_step_id).toBe(firstStep.id); // sanity: activation initialized it onto step_1

    // A genuine advance — exactly what executeMessageStep +
    // advanceParticipantToNextStep do after actually sending the first
    // message — not a hand-set fixture value.
    await advanceParticipantToNextStep(workspaceId, campaign.id, participant.id as string, firstStep.id as string);
    expect(participant.current_step_id).toBe(waitStep.id); // now genuinely on step_2 (the WAIT)
    const lastActionAtAfterAdvance = participant.last_action_at;
    const startedAtAfterAdvance = participant.started_at;

    await transitionCampaign(context, campaign.id, "pause");
    await transitionCampaign(context, campaign.id, "resume");

    // current_step_id, last_action_at, and started_at are byte-for-byte
    // unchanged — pause/resume never re-enters initializeParticipantStep for
    // a participant genuinely mid-sequence: the activation query matches only
    // `status='waiting'` rows, and among those only ones with no
    // current_step_id or one still pointing at the campaign's first step.
    expect(participant.current_step_id).toBe(waitStep.id);
    expect(participant.last_action_at).toBe(lastActionAtAfterAdvance);
    expect(participant.started_at).toBe(startedAtAfterAdvance);
    expect(participant.status).toBe("active");
  });
});

describe("current_step_id initialization — states activation must never touch", () => {
  // The activation guard was widened (it now also matches a waiting
  // participant parked on the campaign's FIRST step, to recover rows written
  // before prospecting.ts stopped stamping current_step_id). These two tests
  // pin the boundaries of that widening, since a guard that is too generous
  // would silently restart a real sequence.
  it("never reinitializes a STOPPED participant, even one sitting on the first step", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    const participant = fakeDatabase.campaignParticipants[0]!;
    const firstStep = fakeDatabase.campaignSteps.filter((s) => s.campaign_id === campaign.id).sort((a, b) => (a.position as number) - (b.position as number))[0]!;
    participant.status = "stopped";
    participant.current_step_id = firstStep.id;
    participant.last_action_at = null;

    await transitionCampaign(context, campaign.id, "activate");

    expect(participant.status).toBe("stopped");
    expect(participant.last_action_at).toBeNull(); // never re-stamped
  });

  it("never reinitializes a participant that already REPLIED", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    const participant = fakeDatabase.campaignParticipants[0]!;
    participant.status = "replied";
    participant.current_step_id = null;

    await transitionCampaign(context, campaign.id, "activate");

    expect(participant.status).toBe("replied");
    expect(participant.current_step_id).toBeNull();
  });

  it("resume never restarts the WAIT timer of an active participant parked on the first step", async () => {
    // The widened guard matches on current_step_id = first step. This proves
    // the `status='waiting'` half of the guard is what keeps a live,
    // mid-WAIT participant out of it — otherwise resuming a paused campaign
    // would silently reset every pending relance's countdown.
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    await transitionCampaign(context, campaign.id, "activate");
    const participant = fakeDatabase.campaignParticipants[0]!;
    const stampedAt = "2026-01-01T00:00:00.000Z";
    participant.last_action_at = stampedAt;

    await transitionCampaign(context, campaign.id, "pause");
    await transitionCampaign(context, campaign.id, "resume");

    expect(participant.last_action_at).toBe(stampedAt);
    expect(participant.status).toBe("active");
  });
});

describe("current_step_id initialization — workspace isolation", () => {
  it("6. transitionCampaign never touches a campaign belonging to another workspace", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);

    const intruderContext: WorkspaceContext = { authUserId: "auth-2", userId: "user-2", workspaceId: "ws-intruder", role: "owner" };
    const result = await transitionCampaign(intruderContext, campaign.id, "activate");

    expect(result).toBeNull();
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "waiting", current_step_id: null });
  });
});

describe("current_step_id initialization — WAIT-first sequence", () => {
  it("8. a campaign starting with WAIT initializes current_step_id onto the WAIT step, with last_action_at set", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createCampaign(context, {
      name: "Wait first",
      objective: "reactivation",
      channelType: "whatsapp",
      participantIds: ["contact-1"],
      steps: [
        { position: 0, stepType: "wait", delayValue: 3, delayUnit: "days" },
        { position: 1, stepType: "message", channelType: "whatsapp", messageTemplate: "Bonjour !" },
        { position: 2, stepType: "end" },
      ],
    });

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
    expect(participant.last_action_at).not.toBeNull();
  });
});

describe("current_step_id initialization — zero steps configured", () => {
  it("9. a campaign with no steps at all never leaves a participant active with current_step_id=NULL", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createCampaign(context, { name: "Empty", objective: "follow_up", channelType: "whatsapp", participantIds: ["contact-1"], steps: [] });

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.status).not.toBe("active");
    expect(participant.status).toBe("completed");
  });
});

describe("current_step_id initialization — atomicity", () => {
  it("10. transitionCampaign now wraps activation in a real transaction — an error during initialization triggers rollback, never commit", async () => {
    seedWhatsAppRelation("contact-1");
    seedWhatsAppRelation("contact-2");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1", "contact-2"]);
    fakeDatabase.transactionLog.length = 0; // discard createCampaign's own begin/commit
    fakeDatabase.setFailInitializationOnCallNumber(2); // fail on the 2nd participant's initialization

    // A pre-existing bug this fix closes: transitionCampaign previously ran
    // its writes with NO transaction wrapper at all (each client.query
    // auto-committed on its own) — meaning the campaign status flip and the
    // participant activation were two independent, separately-committed
    // statements with no rollback protection between them. It is now
    // wrapped in begin/commit/rollback (the same plain pattern already used
    // elsewhere in this file), specifically so this scenario — an error
    // partway through initializing several newly-active participants —
    // can't leave the campaign 'active' with some participants
    // active+current_step_id=null as a silently committed, permanent state.
    await expect(transitionCampaign(context, campaign.id, "activate")).rejects.toThrow("simulated failure during initialization");

    expect(fakeDatabase.transactionLog).toEqual(["begin", "rollback"]); // never reached commit
  });
});

// --- Phase B: WhatsApp campaign audience = existing relationship + canonical
// Conversation + real conversation metadata. ---

describe("listEligibleWhatsAppRelations", () => {
  it("1. identity + real Conversation -> eligible, with real relationship metadata", async () => {
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z" });
    seedMessage("msg-1", "conv-1", { body: "Merci pour votre retour", direction: "inbound", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations).toEqual([{
      id: "contact-1", name: "Contact contact-1", conversationId: "conv-1",
      lastMessageAt: "2026-02-01T10:00:00.000Z", lastMessagePreview: "Merci pour votre retour", lastMessageDirection: "inbound",
    }]);
  });

  it("2. identity WITHOUT a Conversation -> absent from the listing", async () => {
    seedContact("contact-1"); // WhatsApp identity, no conversation seeded at all

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations).toEqual([]);
  });

  it("4. a Conversation WITHOUT a matching identity -> not eligible", async () => {
    // A conversation exists, but the contact has no whatsapp contact_identity
    // row at all (e.g. identity was removed, or never truly established).
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Contact contact-1", company_id: null, archived_at: null });
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z" });

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations).toEqual([]);
  });

  it("5. a Conversation in another workspace is never eligible", async () => {
    seedContact("contact-1");
    seedConversation("conv-intruder", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", workspaceId: "ws-intruder" });

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations).toEqual([]); // the contact's own workspace has no eligible conversation
  });

  it("6. a LinkedIn-only Conversation is never eligible for WhatsApp", async () => {
    seedContact("contact-1");
    seedConversation("conv-li", "contact-1", { channelType: "linkedin", lastMessageAt: "2026-02-01T10:00:00.000Z" });

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations).toEqual([]);
  });

  it("7. multiple WhatsApp Conversations -> the most recent one is selected", async () => {
    seedContact("contact-1");
    seedConversation("conv-old", "contact-1", { lastMessageAt: "2026-01-01T10:00:00.000Z" });
    seedConversation("conv-recent", "contact-1", { lastMessageAt: "2026-02-15T10:00:00.000Z" });

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.conversationId).toBe("conv-recent");
  });

  it("8. a tie on the primary sort value resolves deterministically (created_at, then id)", async () => {
    seedContact("contact-1");
    // Same last_message_at, different created_at -> created_at breaks the tie.
    seedConversation("conv-a", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
    seedConversation("conv-b", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-01-05T00:00:00.000Z" });

    const first = await listEligibleWhatsAppRelations(context);
    expect(first[0]!.conversationId).toBe("conv-b"); // newer created_at wins

    // Same last_message_at AND same created_at -> id is the final,
    // always-deterministic tie-break — never left to insertion/scan order.
    fakeDatabase.conversations.length = 0;
    seedConversation("conv-x", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
    seedConversation("conv-y", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = await listEligibleWhatsAppRelations(context);
    expect(second[0]!.conversationId).toBe("conv-y"); // "conv-y" > "conv-x" lexicographically, id desc

    // Deterministic — repeating the exact same call never flips the answer.
    const third = await listEligibleWhatsAppRelations(context);
    expect(third[0]!.conversationId).toBe("conv-y");
  });

  it("9. last message: preview truncated, drafts ignored, direction and recency correct", async () => {
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:05:00.000Z" });
    seedMessage("msg-1", "conv-1", { body: "Un premier message", direction: "inbound", effectiveTime: "2026-02-01T10:00:00.000Z" });
    seedMessage("msg-2", "conv-1", { body: "x".repeat(200), direction: "outbound", effectiveTime: "2026-02-01T10:05:00.000Z" });
    seedMessage("msg-3-draft", "conv-1", { body: "Brouillon jamais envoyé", direction: "outbound", effectiveTime: "2026-02-01T10:10:00.000Z", status: "draft" });

    const relations = await listEligibleWhatsAppRelations(context);

    expect(relations[0]!.lastMessageDirection).toBe("outbound"); // msg-2, not the later draft
    expect(relations[0]!.lastMessagePreview).toBe(`${"x".repeat(140)}…`); // truncated to 140 chars + ellipsis
    expect(relations[0]!.lastMessagePreview!.length).toBe(141);
  });

  it("10. the response never carries full conversation history — only the single latest message's preview fields", async () => {
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z" });
    for (let i = 0; i < 20; i += 1) seedMessage(`msg-${i}`, "conv-1", { body: `Message ${i}`, effectiveTime: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` });

    const relations = await listEligibleWhatsAppRelations(context);

    const keys = Object.keys(relations[0]!);
    expect(keys).toEqual(expect.arrayContaining(["id", "name", "conversationId", "lastMessageAt", "lastMessagePreview", "lastMessageDirection"]));
    expect(keys).not.toContain("messages");
    expect(keys).not.toContain("history");
    // Only ONE message's data is present — a preview string, never an array.
    expect(typeof relations[0]!.lastMessagePreview).toBe("string");
  });

  it("15. workspace isolation: a relation never leaks across workspaces", async () => {
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z" });
    const otherContext: WorkspaceContext = { authUserId: "auth-2", userId: "user-2", workspaceId: "ws-other", role: "owner" };

    const relations = await listEligibleWhatsAppRelations(otherContext);

    expect(relations).toEqual([]);
  });
});

describe("WhatsApp backend guard — createCampaign / addParticipants", () => {
  it("11. createCampaign refuses a contact with identity but no eligible Conversation, before any participant is created", async () => {
    seedContact("contact-1"); // identity only, no conversation

    await expect(createWhatsAppCampaign("follow_up", ["contact-1"])).rejects.toThrow("Ce contact n’a pas encore de conversation WhatsApp éligible dans Talvia.");
    expect(fakeDatabase.campaigns).toHaveLength(0); // rolled back entirely, nothing partially committed
    expect(fakeDatabase.campaignParticipants).toHaveLength(0);
  });

  it("createCampaign succeeds for a contact with a real eligible Conversation", async () => {
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z" });

    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);

    expect(fakeDatabase.campaignParticipants).toHaveLength(1);
    expect(campaign.participants[0]!.contactId).toBe("contact-1");
  });

  it("12. addParticipants refuses the same way, on an already-existing campaign", async () => {
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z" });
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    seedContact("contact-2"); // identity only, no conversation

    await expect(addParticipants(context, campaign.id, ["contact-2"])).rejects.toThrow("Ce contact n’a pas encore de conversation WhatsApp éligible dans Talvia.");
    expect(fakeDatabase.campaignParticipants.some((p) => p.contact_id === "contact-2")).toBe(false);
  });

  it("does not affect LinkedIn campaigns — the WhatsApp-only guard never runs for other channels", async () => {
    seedContact("contact-li", "linkedin");

    const campaign = await createCampaign(context, {
      name: "LinkedIn sans conversation",
      objective: "prospecting",
      channelType: "linkedin",
      participantIds: ["contact-li"],
      steps: [{ position: 0, stepType: "invite", channelType: "linkedin" }, { position: 1, stepType: "end" }],
    });

    expect(campaign.participants).toHaveLength(1); // identity alone is still sufficient for LinkedIn, unchanged
  });

  it("createCampaign validates N eligible WhatsApp contacts with exactly one bulk query and zero per-contact identity checks", async () => {
    seedWhatsAppRelation("contact-a");
    seedWhatsAppRelation("contact-b");
    seedWhatsAppRelation("contact-c");
    const bulkBefore = fakeDatabase.bulkEligibilityCalls;
    const identityBefore = fakeDatabase.identityCheckCalls;

    const campaign = await createWhatsAppCampaign("follow_up", ["contact-a", "contact-b", "contact-c"]);

    expect(campaign.participants).toHaveLength(3);
    expect(fakeDatabase.bulkEligibilityCalls - bulkBefore).toBe(1); // one bulk query for all 3 contacts, not 3
    expect(fakeDatabase.identityCheckCalls - identityBefore).toBe(0); // hasCompatibleIdentity never runs for WhatsApp anymore
  });

  it("addParticipants validates N eligible WhatsApp contacts added at once with exactly one bulk query and zero per-contact identity checks", async () => {
    seedWhatsAppRelation("contact-seed");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-seed"]);
    seedWhatsAppRelation("contact-b");
    seedWhatsAppRelation("contact-c");
    const bulkBefore = fakeDatabase.bulkEligibilityCalls;
    const identityBefore = fakeDatabase.identityCheckCalls;

    await addParticipants(context, campaign.id, ["contact-b", "contact-c"]);

    expect(fakeDatabase.bulkEligibilityCalls - bulkBefore).toBe(1); // one bulk query for both new contacts, not 2
    expect(fakeDatabase.identityCheckCalls - identityBefore).toBe(0);
  });

  it("LinkedIn keeps calling hasCompatibleIdentity once per contact and never touches the WhatsApp bulk query", async () => {
    seedContact("contact-li-a", "linkedin");
    seedContact("contact-li-b", "linkedin");
    const bulkBefore = fakeDatabase.bulkEligibilityCalls;
    const identityBefore = fakeDatabase.identityCheckCalls;

    const campaign = await createCampaign(context, {
      name: "LinkedIn multi",
      objective: "prospecting",
      channelType: "linkedin",
      participantIds: ["contact-li-a", "contact-li-b"],
      steps: [{ position: 0, stepType: "invite", channelType: "linkedin" }, { position: 1, stepType: "end" }],
    });

    expect(campaign.participants).toHaveLength(2);
    expect(fakeDatabase.identityCheckCalls - identityBefore).toBe(2); // one hasCompatibleIdentity call per contact, unchanged
    expect(fakeDatabase.bulkEligibilityCalls - bulkBefore).toBe(0); // LinkedIn never touches the WhatsApp-only bulk query
  });
});

describe("listing <-> executor consistency (cross-check)", () => {
  it("13. listEligibleWhatsAppRelations and findConversationId resolve to the exact same Conversation, including with multiple candidates", async () => {
    seedContact("contact-1");
    seedConversation("conv-old", "contact-1", { lastMessageAt: "2026-01-01T10:00:00.000Z" });
    seedConversation("conv-recent", "contact-1", { lastMessageAt: "2026-02-15T10:00:00.000Z" });

    const relations = await listEligibleWhatsAppRelations(context);
    const executorResolved = await findConversationId(workspaceId, "contact-1", "whatsapp");

    expect(relations[0]!.conversationId).toBe("conv-recent");
    expect(executorResolved).toBe("conv-recent");
    expect(relations[0]!.conversationId).toBe(executorResolved);
  });

  it("13b. the same consistency holds when the primary sort key ties (relies on the exact same tie-break rule in both paths)", async () => {
    seedContact("contact-1");
    seedConversation("conv-x", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
    seedConversation("conv-y", "contact-1", { lastMessageAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });

    const relations = await listEligibleWhatsAppRelations(context);
    const executorResolved = await findConversationId(workspaceId, "contact-1", "whatsapp");

    expect(relations[0]!.conversationId).toBe(executorResolved);
  });
});

// --- Email audience ---
// Email's eligibility rule is deliberately NOT WhatsApp's. WhatsApp requires a
// real existing Conversation (it is a relation-continuation channel);
// email requires a real usable ADDRESS, because a first mail to a known
// address is a legitimate email capability. These tests exist so the two
// rules can never quietly converge.

function seedEmailContact(id: string, opts: { address?: string; normalized?: string | null; archived?: boolean; workspaceId?: string; createdAt?: string } = {}) {
  const ws = opts.workspaceId ?? workspaceId;
  const address = opts.address ?? `${id}@example.com`;
  fakeDatabase.contacts.push({ id, workspace_id: ws, display_name: `Contact ${id}`, company_id: null, archived_at: opts.archived ? "2026-01-01T00:00:00.000Z" : null });
  fakeDatabase.contactIdentities.push({
    workspace_id: ws, contact_id: id, channel_type: "email", identifier: address,
    identifier_normalized: opts.normalized === undefined ? address.toLowerCase() : opts.normalized,
    created_at: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
  });
}

describe("listEligibleEmailContacts", () => {
  it("includes a Contact with a usable address and NO conversation — the first-touch case", async () => {
    seedEmailContact("contact-1");

    const rows = await listEligibleEmailContacts(context);

    expect(rows).toEqual([{ id: "contact-1", name: "Contact contact-1", address: "contact-1@example.com", hasConversation: false }]);
  });

  it("marks a Contact that already has an email conversation so the UI can say 'the relance follows the thread'", async () => {
    seedEmailContact("contact-1");
    seedConversation("conv-1", "contact-1", { channelType: "email" as never, lastMessageAt: "2026-02-01T00:00:00.000Z" });

    const rows = await listEligibleEmailContacts(context);

    expect(rows[0]).toMatchObject({ id: "contact-1", hasConversation: true, lastMessageAt: "2026-02-01T00:00:00.000Z" });
  });

  it("excludes a Contact whose stored address never normalized to anything usable", async () => {
    seedEmailContact("contact-bad", { address: "pas-une-adresse", normalized: "" });

    expect(await listEligibleEmailContacts(context)).toEqual([]);
  });

  it("excludes an archived Contact", async () => {
    seedEmailContact("contact-archived", { archived: true });

    expect(await listEligibleEmailContacts(context)).toEqual([]);
  });

  it("excludes a Contact with only a WhatsApp or LinkedIn identity", async () => {
    seedContact("contact-wa", "whatsapp");
    seedContact("contact-li", "linkedin");

    expect(await listEligibleEmailContacts(context)).toEqual([]);
  });

  it("never returns another workspace's Contact", async () => {
    seedEmailContact("contact-other", { workspaceId: "ws-2" });

    expect(await listEligibleEmailContacts(context)).toEqual([]);
  });
});

describe("email backend guard — createCampaign / addParticipants", () => {
  it("accepts a Contact with an email address but no conversation (first touch is legitimate)", async () => {
    seedEmailContact("contact-1");

    const campaign = await createCampaign(context, { name: "Relance", objective: "follow_up", channelType: "email", participantIds: ["contact-1"] });

    expect(campaign.participantCount).toBe(1);
  });

  it("rejects a Contact with no usable email address, with an email-specific message", async () => {
    seedContact("contact-wa", "whatsapp");

    await expect(createCampaign(context, { name: "Relance", objective: "follow_up", channelType: "email", participantIds: ["contact-wa"] }))
      .rejects.toThrow(/adresse e-mail exploitable/);
  });

  it("re-checks eligibility server-side when a contact is added to an existing email campaign", async () => {
    seedEmailContact("contact-1");
    seedContact("contact-wa", "whatsapp");
    const campaign = await createCampaign(context, { name: "Relance", objective: "follow_up", channelType: "email", participantIds: ["contact-1"] });

    await expect(addParticipants(context, campaign.id, ["contact-wa"])).rejects.toThrow(/adresse e-mail exploitable/);
  });

  it("checks a whole batch in ONE bulk query — never one round trip per contact", async () => {
    seedEmailContact("contact-1");
    seedEmailContact("contact-2");
    seedEmailContact("contact-3");
    const bulkBefore = fakeDatabase.bulkEligibilityCalls;
    const identityBefore = fakeDatabase.identityCheckCalls;

    await createCampaign(context, { name: "Relance", objective: "follow_up", channelType: "email", participantIds: ["contact-1", "contact-2", "contact-3"] });

    expect(fakeDatabase.bulkEligibilityCalls - bulkBefore).toBe(1);
    expect(fakeDatabase.identityCheckCalls - identityBefore).toBe(0);
  });

  it("persists the campaign's email subject in settings — never invented at send time", async () => {
    seedEmailContact("contact-1");

    const campaign = await createCampaign(context, { name: "Relance", objective: "follow_up", channelType: "email", participantIds: ["contact-1"], emailSubject: "  Suite à notre échange  " });

    expect(campaign.emailSubject).toBe("Suite à notre échange");
  });
});

describe("activation recovers a participant parked on the first step", () => {
  // The bug: prospecting.ts used to stamp current_step_id on EVERY newly
  // approved participant, including those approved while the campaign was
  // still a draft. transitionCampaign's guard excluded them
  // (`current_step_id is null`), so they stayed 'waiting' forever — a status
  // the engine never claims, with no error recorded anywhere.
  it("activates a waiting participant already sitting on the campaign's first step", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createCampaign(context, {
      name: "Relance", objective: "follow_up", channelType: "whatsapp", participantIds: ["contact-1"],
      steps: [{ position: 0, stepType: "message" }, { position: 1, stepType: "end" }],
    });
    const participant = fakeDatabase.campaignParticipants.find((p) => p.campaign_id === campaign.id)!;
    const firstStep = fakeDatabase.campaignSteps.filter((s) => s.campaign_id === campaign.id).sort((a, b) => (a.position as number) - (b.position as number))[0]!;
    // Exactly the legacy shape.
    participant.current_step_id = firstStep.id;

    await transitionCampaign(context, campaign.id, "activate");

    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe(firstStep.id);
    // last_action_at is what a later WAIT step computes its due date from.
    expect(participant.last_action_at).not.toBeNull();
  });

  it("still refuses to re-initialize a participant genuinely mid-sequence", async () => {
    seedWhatsAppRelation("contact-1");
    const campaign = await createCampaign(context, {
      name: "Relance", objective: "follow_up", channelType: "whatsapp", participantIds: ["contact-1"],
      steps: [{ position: 0, stepType: "message" }, { position: 1, stepType: "message" }, { position: 2, stepType: "end" }],
    });
    const participant = fakeDatabase.campaignParticipants.find((p) => p.campaign_id === campaign.id)!;
    const steps = fakeDatabase.campaignSteps.filter((s) => s.campaign_id === campaign.id).sort((a, b) => (a.position as number) - (b.position as number));
    participant.current_step_id = steps[1]!.id;

    await transitionCampaign(context, campaign.id, "activate");

    expect(participant.status).toBe("waiting");
    expect(participant.current_step_id).toBe(steps[1]!.id);
  });
});

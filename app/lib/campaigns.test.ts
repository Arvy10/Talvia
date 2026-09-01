import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "./workspace-context";

// Fake DB by SQL prefix — same approach as
// campaign-execution/step-progression.test.ts and
// providers/unipile-adapter.test.ts. Covers campaigns/campaign_steps/
// campaign_participants/contacts/companies/contact_identities/activities,
// enough to exercise createCampaign/transitionCampaign/addParticipants end
// to end, including the new current_step_id initialization they now trigger
// via step-progression.ts's real (unmocked) advanceParticipantToNextStep.
function createFakeDatabase() {
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const companies: Array<Record<string, unknown>> = [];
  const contactIdentities: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  const transactionLog: string[] = [];
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
      const [workspaceId, contactId, channelType] = params as [string, string, string];
      const contact = contacts.find((c) => c.workspace_id === workspaceId && c.id === contactId && !c.archived_at);
      const hasIdentity = contact && contactIdentities.some((ci) => ci.workspace_id === workspaceId && ci.contact_id === contactId && ci.channel_type === channelType);
      return { rows: hasIdentity ? [{ id: contactId }] : [] };
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
    if (text.startsWith("update campaign_participants set status='active',started_at=coalesce(started_at,now()),updated_at=now() where campaign_id=$1 and status='waiting' and current_step_id is null returning id")) {
      const [campaignId] = params as [string];
      const matches = campaignParticipants.filter((p) => p.campaign_id === campaignId && p.status === "waiting" && !p.current_step_id);
      for (const p of matches) { p.status = "active"; p.started_at = p.started_at ?? new Date().toISOString(); }
      return { rows: matches.map((p) => ({ id: p.id })) };
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
    campaigns, campaignSteps, campaignParticipants, contacts, companies, contactIdentities, activities, transactionLog,
    setFailInitializationOnCallNumber: (n: number | null) => { failInitializationOnCallNumber = n; },
  };
}

let fakeDatabase = createFakeDatabase();
vi.mock("./database", () => ({ get database() { return fakeDatabase; } }));

const { addParticipants, createCampaign, transitionCampaign } = await import("./campaigns");
const { advanceParticipantToNextStep } = await import("./campaign-execution/step-progression");

beforeEach(() => { fakeDatabase = createFakeDatabase(); });

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function seedContact(id: string, channelType: "whatsapp" | "linkedin" = "whatsapp") {
  fakeDatabase.contacts.push({ id, workspace_id: workspaceId, display_name: `Contact ${id}`, company_id: null, archived_at: null });
  fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: id, channel_type: channelType });
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
    seedContact("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "waiting", current_step_id: null });

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
    expect(participant.last_action_at).not.toBeNull();
  });

  it("2. reactivation: same guarantee as follow_up", async () => {
    seedContact("contact-1");
    const campaign = await createWhatsAppCampaign("reactivation", ["contact-1"]);

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
  });
});

describe("current_step_id initialization — addParticipants", () => {
  it("3. adding a contact to an already-active campaign initializes it immediately", async () => {
    seedContact("contact-1");
    seedContact("contact-2");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);
    await transitionCampaign(context, campaign.id, "activate");

    await addParticipants(context, campaign.id, ["contact-2"]);

    const newParticipant = fakeDatabase.campaignParticipants.find((p) => p.contact_id === "contact-2")!;
    expect(newParticipant.status).toBe("active");
    expect(newParticipant.current_step_id).toBe(fakeDatabase.campaignSteps.find((s) => s.position === 0)!.id);
  });

  it("4a. adding a contact to a still-draft campaign leaves it waiting, current_step_id null", async () => {
    seedContact("contact-1");
    seedContact("contact-2");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]); // draft, never activated

    await addParticipants(context, campaign.id, ["contact-2"]);

    const newParticipant = fakeDatabase.campaignParticipants.find((p) => p.contact_id === "contact-2")!;
    expect(newParticipant.status).toBe("waiting");
    expect(newParticipant.current_step_id).toBeNull();
  });

  it("4b. ...and activating the campaign afterward initializes it then, not before", async () => {
    seedContact("contact-1");
    seedContact("contact-2");
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
    seedContact("contact-1");
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
    // unchanged — pause/resume never re-enters initializeParticipantStep
    // for a participant whose current_step_id is already non-null (the
    // `and current_step_id is null` guard on the activation query).
    expect(participant.current_step_id).toBe(waitStep.id);
    expect(participant.last_action_at).toBe(lastActionAtAfterAdvance);
    expect(participant.started_at).toBe(startedAtAfterAdvance);
    expect(participant.status).toBe("active");
  });
});

describe("current_step_id initialization — workspace isolation", () => {
  it("6. transitionCampaign never touches a campaign belonging to another workspace", async () => {
    seedContact("contact-1");
    const campaign = await createWhatsAppCampaign("follow_up", ["contact-1"]);

    const intruderContext: WorkspaceContext = { authUserId: "auth-2", userId: "user-2", workspaceId: "ws-intruder", role: "owner" };
    const result = await transitionCampaign(intruderContext, campaign.id, "activate");

    expect(result).toBeNull();
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "waiting", current_step_id: null });
  });
});

describe("current_step_id initialization — WAIT-first sequence", () => {
  it("8. a campaign starting with WAIT initializes current_step_id onto the WAIT step, with last_action_at set", async () => {
    seedContact("contact-1");
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
    seedContact("contact-1");
    const campaign = await createCampaign(context, { name: "Empty", objective: "follow_up", channelType: "whatsapp", participantIds: ["contact-1"], steps: [] });

    await transitionCampaign(context, campaign.id, "activate");

    const participant = fakeDatabase.campaignParticipants[0]!;
    expect(participant.status).not.toBe("active");
    expect(participant.status).toBe("completed");
  });
});

describe("current_step_id initialization — atomicity", () => {
  it("10. transitionCampaign now wraps activation in a real transaction — an error during initialization triggers rollback, never commit", async () => {
    seedContact("contact-1");
    seedContact("contact-2");
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

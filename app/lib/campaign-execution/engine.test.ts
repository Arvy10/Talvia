import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "../workspace-context";

// Combined fake DB — the union of step-progression.test.ts's and
// linkedin-executor.test.ts's handlers, because runDueCampaignActions (the
// function under test here) genuinely calls BOTH consumeDueWaitSteps() and
// runDueLinkedInActions() against the same `database` mock, in one call.
// This file exists specifically to close the gap the Phase 4 audit found:
// no test previously exercised that real, combined flow end to end.
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const candidates: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  const UNIT_MS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
  function isDue(participant: Record<string, unknown>, step: Record<string, unknown> | undefined): boolean {
    if (!step || step.step_type !== "wait") return false;
    const lastActionAt = participant.last_action_at as string | null;
    if (!lastActionAt) return false;
    const delayMs = (step.delay_value as number) * (UNIT_MS[step.delay_unit as string] ?? UNIT_MS.days);
    return new Date(lastActionAt).getTime() + delayMs <= Date.now();
  }
  function claimIsStale(participant: Record<string, unknown>): boolean {
    const claimedAt = participant.step_claimed_at as string | null;
    if (!claimedAt) return true;
    return Date.now() - new Date(claimedAt).getTime() > 10 * 60_000;
  }

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };

    // --- engine.ts ---
    if (text.startsWith("select channel_type,objective from campaigns where workspace_id=$1 and id=$2")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      return { rows: row ? [{ channel_type: row.channel_type, objective: row.objective }] : [] };
    }

    // --- step-progression.ts / linkedin-executor.ts (shared query text) ---
    if (text.startsWith("select status from campaigns where workspace_id=$1 and id=$2")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      return { rows: row ? [{ status: row.status }] : [] };
    }
    if (text.startsWith("select status,current_step_id from campaign_participants where id=$1")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      return { rows: row ? [{ status: row.status, current_step_id: row.current_step_id }] : [] };
    }
    if (text.startsWith("update campaign_participants set step_claimed_at=null where id=$1")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) row.step_claimed_at = null;
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=coalesce($1,current_step_id),status='completed'")) {
      const [nextStepId, id] = params as [string | null, string];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId ?? row.current_step_id; row.status = "completed"; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=$1,step_claimed_at=null")) {
      const [nextStepId, id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("select position from campaign_steps where campaign_id=$1 and id=$2")) {
      const [campaignId, stepId] = params as string[];
      const row = campaignSteps.find((s) => s.campaign_id === campaignId && s.id === stepId);
      return { rows: row ? [{ position: row.position }] : [] };
    }
    if (text.startsWith("select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and position>$2")) {
      const [campaignId, position] = params as [string, number];
      const row = campaignSteps.filter((s) => s.campaign_id === campaignId && (s.position as number) > Number(position)).sort((a, b) => (a.position as number) - (b.position as number))[0];
      return { rows: row ? [{ id: row.id, position: row.position, step_type: row.step_type, message_template: row.message_template ?? null }] : [] };
    }
    if (text.startsWith("select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and id=$2")) {
      const [campaignId, stepId] = params as string[];
      const row = campaignSteps.find((s) => s.campaign_id === campaignId && s.id === stepId);
      return { rows: row ? [{ id: row.id, position: row.position, step_type: row.step_type, message_template: row.message_template ?? null }] : [] };
    }
    if (text.startsWith("insert into activities")) {
      const row = { id: nextId("activity") };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: new Date().toISOString() }] };
    }
    // The WAIT claim (step-progression.ts's claimDueWaitParticipants).
    if (text.startsWith("update campaign_participants p set step_claimed_at=now() where p.id in ( select p2.id from campaign_participants p2 join campaign_steps s on s.id = p2.current_step_id where p2.campaign_id=$1 and p2.status='active' and s.step_type='wait'")) {
      const [campaignId, limit] = params as [string, number];
      const eligible = campaignParticipants
        .filter((p) => {
          const step = campaignSteps.find((s) => s.id === p.current_step_id);
          return p.campaign_id === campaignId && p.status === "active" && isDue(p, step) && claimIsStale(p);
        })
        .slice(0, limit);
      for (const p of eligible) p.step_claimed_at = new Date().toISOString();
      return { rows: eligible.map((p) => ({ id: p.id, current_step_id: p.current_step_id })) };
    }

    // --- email-executor.ts (same shape the WhatsApp executor uses) ---
    if (text.startsWith("select exists(select 1 from connections where workspace_id=$1 and provider='unipile' and channel_type='email' and status='connected')")) {
      const [workspaceId] = params as string[];
      return { rows: [{ connected: connections.some((c) => c.workspace_id === workspaceId && c.channel_type === "email" && c.status === "connected") }] };
    }
    if (text.startsWith("select step_type from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").map((s) => ({ step_type: s.step_type })) };
    }

    // --- linkedin-executor.ts ---
    if (text.startsWith("select external_account_id from connections")) {
      const [workspaceId] = params as string[];
      const row = connections.find((c) => c.workspace_id === workspaceId && c.status === "connected");
      return { rows: row ? [{ external_account_id: row.external_account_id }] : [] };
    }
    if (text.startsWith("select step_type from campaign_steps where campaign_id=$1 and step_type in")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && (s.step_type === "invite" || s.step_type === "message")).map((s) => ({ step_type: s.step_type })) };
    }
    if (text.startsWith("select count(*)::int as count from campaign_participants")) {
      const [workspaceId] = params as string[];
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const count = campaignParticipants.filter((p) => {
        const campaign = campaigns.find((c) => c.id === p.campaign_id);
        return campaign?.workspace_id === workspaceId && p.invite_sent_at && new Date(p.invite_sent_at as string) >= midnight;
      }).length;
      return { rows: [{ count }] };
    }
    // The invite/message claim (linkedin-executor.ts's claimByStepType) —
    // distinguished from the WAIT claim above by its literal step_type=$2
    // parameter placeholder instead of the wait-specific '='wait'' literal.
    if (text.startsWith("update campaign_participants p set step_claimed_at=now() where p.id in ( select p2.id from campaign_participants p2 join campaign_steps s on s.id = p2.current_step_id where p2.campaign_id=$1 and p2.status='active' and s.step_type=$2")) {
      const [campaignId, stepType, limit] = params as [string, string, number];
      const doneColumn = stepType === "invite" ? "invite_sent_at" : "message_sent_at";
      const eligible = campaignParticipants
        .filter((p) => {
          const step = campaignSteps.find((s) => s.id === p.current_step_id);
          return p.campaign_id === campaignId && p.status === "active" && step?.step_type === stepType && !p[doneColumn] && (!p.step_claimed_at || claimIsStale(p));
        })
        .slice(0, limit);
      for (const p of eligible) p.step_claimed_at = new Date().toISOString();
      return { rows: eligible.map((p) => ({ id: p.id, contact_id: p.contact_id, current_step_id: p.current_step_id })) };
    }
    if (text.startsWith("select p.id from campaign_participants p join campaign_steps s on s.id=p.current_step_id where p.campaign_id=$1 and p.status='active' and s.step_type='invite'")) {
      const [campaignId] = params as string[];
      const row = campaignParticipants.find((p) => {
        const step = campaignSteps.find((s) => s.id === p.current_step_id);
        return p.campaign_id === campaignId && p.status === "active" && step?.step_type === "invite" && !p.invite_sent_at;
      });
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (text.startsWith("select provider_id from campaign_prospect_candidates")) {
      const [workspaceId, campaignId, contactId] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.contact_id === contactId && c.status === "approved");
      return { rows: row ? [{ provider_id: row.provider_id }] : [] };
    }
    if (text.startsWith("select p.personalization from campaign_participants p join campaigns c")) {
      const [workspaceId, campaignId, participantId] = params as string[];
      const campaign = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      const row = campaignParticipants.find((p) => p.id === participantId && p.campaign_id === campaignId);
      if (!campaign || !row) return { rows: [] };
      return { rows: [{ personalization: row.personalization ?? null }] };
    }
    if (text.startsWith("select id,position from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").map((s) => ({ id: s.id, position: s.position })) };
    }
    if (text.startsWith("update campaign_participants set invite_sent_at=now()")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.invite_sent_at = new Date().toISOString(); row.step_claimed_at = null; }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set message_sent_at=now()")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.message_sent_at = new Date().toISOString(); row.step_claimed_at = null; }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set last_error_code=$2,last_error_at=now()")) {
      const [id, code] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.last_error_code = code; row.last_error_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set last_error_code=null,last_error_at=null")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.last_error_code = null; row.last_error_at = null; }
      return { rows: [] };
    }
    // conversation-resolution.ts's canonical rule. The channel comes from $3
    // — it used to be hardcoded to 'linkedin' here, which was invisible while
    // only LinkedIn had an executor but would have hidden a real
    // channel-crossing bug (executeMessageStep passes channelType precisely so
    // a Contact's LinkedIn thread can never receive an email campaign's
    // message, and vice versa).
    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2")) {
      const [workspaceId, contactId, channelType] = params as string[];
      const row = conversations.find((c) => c.workspace_id === workspaceId && c.contact_id === contactId && c.channel_type === channelType);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, campaigns, campaignSteps, campaignParticipants, candidates, conversations, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

const sendLinkedInInvitationMock = vi.hoisted(() => vi.fn(async () => "invitation-1"));
vi.mock("../providers/unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  sendLinkedInInvitation: sendLinkedInInvitationMock,
}));
// Declared with sendMessage's real signature (including the 4th
// idempotency-key argument) so mock.calls is typed and the key assertions
// below can read call[3] instead of casting.
const sendMessageMock = vi.hoisted(() => vi.fn(async (_workspaceId: string, _conversationId: string, _text: string, _idempotencyKey?: string) => ({ id: "msg-1", body: "", direction: "outbound" as const, status: "sent" as const, createdAt: new Date().toISOString() })));
vi.mock("../providers/unipile-adapter", () => ({ sendMessage: sendMessageMock }));
vi.mock("../ai", () => ({ getAIProvider: () => null }));
vi.mock("../business-context/business-context-service", () => ({ getActiveBusinessContext: async () => null }));

const { runDueCampaignActions } = await import("./engine");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  sendLinkedInInvitationMock.mockClear();
  sendMessageMock.mockClear();
});

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function ago(ms: number): string { return new Date(Date.now() - ms).toISOString(); }
const DAY = 86_400_000;

const EMPTY_TEXT = { status: "not_generated", generatedText: null, editedText: null, approvedText: null, approvedAt: null };

function seedConnectedAccount() {
  fakeDatabase.connections.push({ workspace_id: workspaceId, provider: "unipile", channel_type: "linkedin", external_account_id: "acct-1", status: "connected" });
}

// invite(0) -> message1(1) -> wait 3d(2) -> message2(3) -> end(4)
function seedSequence(campaignId: string, status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status, channel_type: "linkedin", objective: "prospecting" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-invite`, campaign_id: campaignId, position: 0, step_type: "invite", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 1, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 2, step_type: "wait", delay_value: 3, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg2`, campaign_id: campaignId, position: 3, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 4, step_type: "end", message_template: null });
}

// Message #1 already sent, participant is on the WAIT step, due, with
// message #2 already approved — everything is primed to send the instant
// the WAIT is consumed, which is exactly the window this test probes.
function seedParticipantOnDueWait(campaignId: string, participantId: string) {
  fakeDatabase.conversations.push({ id: `conv-${participantId}`, workspace_id: workspaceId, contact_id: `contact-${participantId}`, channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
  fakeDatabase.campaignParticipants.push({
    id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status: "active", current_step_id: `${campaignId}-wait`,
    invite_sent_at: ago(4 * DAY), invite_accepted_at: ago(4 * DAY), message_sent_at: null, step_claimed_at: null, last_action_at: ago(3 * DAY + 60_000),
    personalization: {
      evidence: { observedFacts: [], qualificationContext: null, strategyContext: null, uncertainties: [] },
      outreachAngle: null,
      invitation: EMPTY_TEXT,
      messages: [{ stepId: `${campaignId}-msg2`, ...EMPTY_TEXT, status: "approved", generatedText: "Message 2 approuvé.", approvedText: "Message 2 approuvé.", approvedAt: new Date().toISOString() }],
      generatedAt: new Date().toISOString(), aiModel: null,
    },
  });
  return fakeDatabase.campaignParticipants[fakeDatabase.campaignParticipants.length - 1]!;
}

describe("runDueCampaignActions — combined E2E: WAIT consumed then message attempted (baseline)", () => {
  it("consumes the WAIT and sends message #2 in the same call when nothing interferes", async () => {
    seedConnectedAccount();
    seedSequence("camp-1");
    const participant = seedParticipantOnDueWait("camp-1", "part-1");

    await runDueCampaignActions(context, "camp-1");

    // 4th arg: the provider idempotency key for this (participant, step).
    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-part-1", "Message 2 approuvé.", "part-1:camp-1-msg2");
    expect(participant.current_step_id).toBe("camp-1-end");
    expect(participant.status).toBe("completed");
  });
});

describe("runDueCampaignActions — combined E2E: reply lands after WAIT consumption, before provider call (Phase 4B §2)", () => {
  it("closes the exact gap the Phase 4 audit found: WAIT consumed -> message #2 current -> reply commits after reverifyEligibility but before send -> provider never called", async () => {
    seedConnectedAccount();
    seedSequence("camp-1");
    const participant = seedParticipantOnDueWait("camp-1", "part-1");

    const originalQuery = fakeDatabase.query;
    let statusReadCount = 0;
    let replyInjectedAfterReverify = false;
    fakeDatabase.query = async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();
      const isStatusRead = text.startsWith("select status,current_step_id from campaign_participants where id=$1") && params[0] === participant.id;
      if (isStatusRead) {
        statusReadCount += 1;
        // 1st occurrence: consumeDueWaitSteps's own fresh check (still active
        // — the WAIT genuinely gets consumed here). 2nd occurrence:
        // reverifyEligibility() inside runDueLinkedInActions — still active
        // at this exact read, proving the reply truly lands AFTER it. Only
        // once this 2nd read has already returned do we flip the participant
        // to 'replied', so the 3rd occurrence (checkParticipantStillActive,
        // the Phase 4B final check, immediately before sendMessage) is the
        // one that actually has to catch it.
        if (statusReadCount === 2) {
          const result = await originalQuery(sql, params);
          participant.status = "replied";
          replyInjectedAfterReverify = true;
          return result;
        }
      }
      return originalQuery(sql, params);
    };

    await runDueCampaignActions(context, "camp-1");

    expect(replyInjectedAfterReverify).toBe(true);
    expect(statusReadCount).toBeGreaterThanOrEqual(3); // consumeDueWaitSteps + reverifyEligibility + the new final check
    // The WAIT itself was still legitimately consumed (it elapsed before any
    // reply existed) — the participant is on message #2, not stuck on WAIT.
    expect(participant.current_step_id).toBe("camp-1-msg2");
    expect(participant.status).toBe("replied");
    // The one invariant this whole test exists to prove:
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

// Email routes through the SAME engine: same dispatch table, same WAIT
// consumption, same claim/reverify/send path — the only email-specific part
// is which connection must exist and which channel resolves the
// conversation. These tests exist to prove there is no second engine.
function seedConnectedEmailAccount() {
  fakeDatabase.connections.push({ workspace_id: workspaceId, provider: "unipile", channel_type: "email", external_account_id: "acct-google-1", status: "connected" });
}

// message(0) -> wait 3d(1) -> message(2) -> end(3) — no invite step, the
// same shape a WhatsApp follow-up uses.
function seedEmailSequence(campaignId: string, objective = "follow_up", status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status, channel_type: "email", objective });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 0, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 1, step_type: "wait", delay_value: 3, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg2`, campaign_id: campaignId, position: 2, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 3, step_type: "end", message_template: null });
}

function seedEmailParticipantOnDueWait(campaignId: string, participantId: string, approvedText: string | null = "Relance e-mail approuvée.") {
  fakeDatabase.conversations.push({ id: `conv-${participantId}`, workspace_id: workspaceId, contact_id: `contact-${participantId}`, channel_type: "email", last_message_at: null, created_at: new Date().toISOString() });
  fakeDatabase.campaignParticipants.push({
    id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status: "active", current_step_id: `${campaignId}-wait`,
    invite_sent_at: null, invite_accepted_at: null, message_sent_at: null, step_claimed_at: null, last_action_at: ago(3 * DAY + 60_000),
    personalization: {
      evidence: { observedFacts: [], qualificationContext: null, strategyContext: null, uncertainties: [] },
      outreachAngle: null,
      invitation: EMPTY_TEXT,
      messages: [approvedText
        ? { stepId: `${campaignId}-msg2`, ...EMPTY_TEXT, status: "approved", generatedText: approvedText, approvedText, approvedAt: new Date().toISOString() }
        : { stepId: `${campaignId}-msg2`, ...EMPTY_TEXT, status: "generated", generatedText: "Proposition non approuvée." }],
      generatedAt: new Date().toISOString(), aiModel: null,
    },
  });
  return fakeDatabase.campaignParticipants[fakeDatabase.campaignParticipants.length - 1]!;
}

describe("runDueCampaignActions — email dispatch (one engine, not a second one)", () => {
  it("consumes the WAIT and sends the approved email through the shared send path", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email");
    const participant = seedEmailParticipantOnDueWait("camp-email", "part-email");

    const summary = await runDueCampaignActions(context, "camp-email");

    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-part-email", "Relance e-mail approuvée.", "part-email:camp-email-msg2");
    expect(summary.sent).toBe(1);
    expect(participant.current_step_id).toBe("camp-email-end");
    expect(participant.status).toBe("completed");
  });

  it("never sends without an approvedText, exactly like every other channel", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email");
    seedEmailParticipantOnDueWait("camp-email", "part-email", null);

    const summary = await runDueCampaignActions(context, "camp-email");

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(1);
  });

  it("blocks with NO_EMAIL_CONNECTION rather than pretending to send when no email account is connected", async () => {
    seedEmailSequence("camp-email");
    seedEmailParticipantOnDueWait("camp-email", "part-email");

    const summary = await runDueCampaignActions(context, "camp-email");

    expect(summary.blockedReason).toBe("NO_EMAIL_CONNECTION");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("does not send for a paused email campaign", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email", "follow_up", "paused");
    seedEmailParticipantOnDueWait("camp-email", "part-email");

    const summary = await runDueCampaignActions(context, "camp-email");

    expect(summary.blockedReason).toBe("CAMPAIGN_PAUSED");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("has no executor for email + prospecting — that flow is LinkedIn's invite/accept, not an error", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email", "prospecting");
    seedEmailParticipantOnDueWait("camp-email", "part-email");

    const summary = await runDueCampaignActions(context, "camp-email");

    expect(summary).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

// The double-send window this closes: the provider accepts the email, the
// HTTP response is lost, nothing records message_sent_at, the claim is
// released, and the next engine run retries. Only the provider can
// deduplicate that — and only if Talvia hands it the SAME key both times.
describe("email send idempotency key (provider-side double-send protection)", () => {
  const keyOf = (callIndex: number) => sendMessageMock.mock.calls[callIndex]![3];

  it("sends the same key on a retry of the same participant+step after a provider failure", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email");
    const participant = seedEmailParticipantOnDueWait("camp-email", "part-email");

    // Attempt 1: the provider call throws (timeout). The engine must not
    // record a send, and must leave the participant retryable.
    sendMessageMock.mockRejectedValueOnce(new Error("Unipile send email failed (504)."));
    await runDueCampaignActions(context, "camp-email");
    expect(participant.message_sent_at).toBeFalsy();
    expect(participant.step_claimed_at).toBeNull(); // claim released -> retryable

    // Attempt 2: the retry of that same business action.
    await runDueCampaignActions(context, "camp-email");

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).toBe(keyOf(1));
    expect(keyOf(0)).toBe("part-email:camp-email-msg2");
  });

  it("gives a different key to a different participant and to a different step", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email");
    seedEmailParticipantOnDueWait("camp-email", "part-a");
    seedEmailParticipantOnDueWait("camp-email", "part-b");

    await runDueCampaignActions(context, "camp-email");

    const keys = sendMessageMock.mock.calls.map((call) => call[3]);
    expect(new Set(keys).size).toBe(keys.length); // no two sends share a key
    expect(keys).toContain("part-a:camp-email-msg2");
    expect(keys).toContain("part-b:camp-email-msg2");

    // A different step of the same participant is a different action.
    sendMessageMock.mockClear();
    seedEmailSequence("camp-two");
    seedEmailParticipantOnDueWait("camp-two", "part-a2");
    await runDueCampaignActions(context, "camp-two");
    expect(sendMessageMock.mock.calls[0]![3]).toBe("part-a2:camp-two-msg2");
  });

  it("never derives the key from anything random — the same run twice produces the identical key", async () => {
    seedConnectedEmailAccount();
    seedEmailSequence("camp-email");
    seedEmailParticipantOnDueWait("camp-email", "part-email");
    sendMessageMock.mockRejectedValueOnce(new Error("boom"));
    await runDueCampaignActions(context, "camp-email");
    sendMessageMock.mockRejectedValueOnce(new Error("boom"));
    await runDueCampaignActions(context, "camp-email");
    await runDueCampaignActions(context, "camp-email");

    const keys = sendMessageMock.mock.calls.map((call) => call[3]);
    expect(new Set(keys).size).toBe(1);
  });
});

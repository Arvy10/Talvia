import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "../workspace-context";

// Fake DB by SQL prefix — same approach as the other test files in this
// repo. Covers everything the executor AND step-progression.ts (imported
// statically, exercised for real — advancement logic is core to this
// chantier, not something to mock away) touch.
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const candidates: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };

    if (text.startsWith("select external_account_id from connections")) {
      const [workspaceId] = params as string[];
      const row = connections.find((c) => c.workspace_id === workspaceId && c.status === "connected");
      return { rows: row ? [{ external_account_id: row.external_account_id }] : [] };
    }
    if (text.startsWith("select status from campaigns")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.workspace_id === workspaceId && c.id === campaignId);
      return { rows: row ? [{ status: row.status }] : [] };
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
    if (text.startsWith("update campaign_participants p set step_claimed_at=now() where p.id in")) {
      const [campaignId, stepType, limit] = params as [string, string, number];
      const doneColumn = stepType === "invite" ? "invite_sent_at" : "message_sent_at";
      const eligible = campaignParticipants
        .filter((p) => {
          const step = campaignSteps.find((s) => s.id === p.current_step_id);
          return p.campaign_id === campaignId && p.status === "active" && step?.step_type === stepType && !p[doneColumn] && !p.step_claimed_at;
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
    if (text.startsWith("select status,current_step_id from campaign_participants where id=$1")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      return { rows: row ? [{ status: row.status, current_step_id: row.current_step_id }] : [] };
    }
    if (text.startsWith("select provider_id from campaign_prospect_candidates")) {
      const [workspaceId, campaignId, contactId] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.contact_id === contactId && c.status === "approved");
      return { rows: row ? [{ provider_id: row.provider_id }] : [] };
    }
    if (text.startsWith("select id,position from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").map((s) => ({ id: s.id, position: s.position })) };
    }
    if (text.startsWith("select p.personalization from campaign_participants p join campaigns c")) {
      const [workspaceId, campaignId, participantId] = params as string[];
      const campaign = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      const row = campaignParticipants.find((p) => p.id === participantId && p.campaign_id === campaignId);
      if (!campaign || !row) return { rows: [] };
      return { rows: [{ personalization: row.personalization ?? null }] };
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
    if (text.startsWith("update campaign_participants set step_claimed_at=null where id=$1")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) row.step_claimed_at = null;
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
    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2")) {
      const [workspaceId, contactId] = params as string[];
      const row = conversations.find((c) => c.workspace_id === workspaceId && c.contact_id === contactId && c.channel_type === "linkedin");
      return { rows: row ? [{ id: row.id }] : [] };
    }
    // --- step-progression.ts ---
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
    if (text.startsWith("update campaign_participants set current_step_id=coalesce($1,current_step_id),status='completed'")) {
      const [nextStepId, id] = params as [string | null, string];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId ?? row.current_step_id; row.status = "completed"; row.step_claimed_at = null; }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=$1,step_claimed_at=null")) {
      const [nextStepId, id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId; row.step_claimed_at = null; }
      return { rows: [] };
    }
    if (text.startsWith("insert into activities")) {
      const row = { id: nextId("activity") };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: new Date().toISOString() }] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, campaigns, campaignSteps, campaignParticipants, candidates, conversations, contacts, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

const sendLinkedInInvitationMock = vi.hoisted(() => vi.fn(async () => "invitation-1"));
vi.mock("../providers/unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  sendLinkedInInvitation: sendLinkedInInvitationMock,
}));
const sendMessageMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg-1", body: "", direction: "outbound" as const, status: "sent" as const, createdAt: new Date().toISOString() })));
vi.mock("../providers/unipile-adapter", () => ({ sendMessage: sendMessageMock }));
// No AI key configured — exercises the deterministic template fallback.
vi.mock("../ai", () => ({ getAIProvider: () => null }));
vi.mock("../business-context/business-context-service", () => ({ getActiveBusinessContext: async () => null }));

const { runDueLinkedInActions, linkedInExecutor } = await import("./linkedin-executor");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  sendLinkedInInvitationMock.mockClear();
  sendMessageMock.mockClear();
  delete process.env.LINKEDIN_DAILY_INVITE_LIMIT;
});

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function seedConnectedAccount(forWorkspaceId = workspaceId) {
  fakeDatabase.connections.push({ workspace_id: forWorkspaceId, provider: "unipile", channel_type: "linkedin", external_account_id: "acct-1", status: "connected" });
}

// invite(0) -> message(1) -> end(2), same shape CampaignsClient.tsx creates.
function seedCampaignWithSteps(campaignId: string, status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-invite`, campaign_id: campaignId, position: 0, step_type: "invite", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-message`, campaign_id: campaignId, position: 1, step_type: "message", message_template: "Bonjour {first_name}, ravi ! {company}" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 2, step_type: "end", message_template: null });
}

const EMPTY_TEXT = { status: "not_generated", generatedText: null, editedText: null, approvedText: null, approvedAt: null };
function approvedPersonalization(approvedInvitationText: string | null, messageStepId?: string, approvedMessageText?: string | null) {
  return {
    evidence: { facts: [], uncertainties: [] },
    outreachAngle: null,
    invitation: approvedInvitationText ? { ...EMPTY_TEXT, status: "approved", generatedText: approvedInvitationText, approvedText: approvedInvitationText, approvedAt: new Date().toISOString() } : { ...EMPTY_TEXT },
    messages: messageStepId && approvedMessageText ? [{ stepId: messageStepId, ...EMPTY_TEXT, status: "approved", generatedText: approvedMessageText, approvedText: approvedMessageText, approvedAt: new Date().toISOString() }] : [],
    generatedAt: new Date().toISOString(),
    aiModel: null,
  };
}

// Approved by default — Phase 3's own MESSAGE_NOT_APPROVED guard is tested
// separately, explicitly, by seeding a participant with no personalization.
function seedParticipantOnInviteStep(campaignId: string, participantId = "part-1") {
  fakeDatabase.candidates.push({ id: `cand-${participantId}`, workspace_id: workspaceId, campaign_id: campaignId, provider_id: "prov-1", name: "Awa Traoré", headline: "Directrice marketing", status: "approved", contact_id: `contact-${participantId}` });
  fakeDatabase.campaignParticipants.push({ id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status: "active", current_step_id: `${campaignId}-invite`, invite_sent_at: null, message_sent_at: null, step_claimed_at: null, personalization: approvedPersonalization("Bonjour Awa, ravi d'échanger !") });
  return fakeDatabase.campaignParticipants[fakeDatabase.campaignParticipants.length - 1]!;
}

function seedParticipantOnMessageStep(campaignId: string, participantId = "part-msg-1") {
  fakeDatabase.conversations.push({ id: `conv-${participantId}`, workspace_id: workspaceId, contact_id: `contact-${participantId}`, channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
  fakeDatabase.campaignParticipants.push({
    id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status: "active", current_step_id: `${campaignId}-message`, invite_sent_at: new Date().toISOString(), invite_accepted_at: new Date().toISOString(), message_sent_at: null, step_claimed_at: null,
    personalization: approvedPersonalization(null, `${campaignId}-message`, "Bonjour Jane, ravi de vous compter parmi mes relations !"),
  });
  return fakeDatabase.campaignParticipants[fakeDatabase.campaignParticipants.length - 1]!;
}

describe("runDueLinkedInActions — invite step (A)", () => {
  it("sends the invitation and stays on the invite step, waiting for the acceptance webhook", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnInviteStep("camp-1");

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sendLinkedInInvitationMock).toHaveBeenCalledWith(expect.anything(), "acct-1", "prov-1", expect.stringContaining("Awa"));
    expect(participant.invite_sent_at).not.toBeNull();
    // Correct progression for an event-gated step: does NOT advance past
    // invite on its own — only the acceptance webhook does that.
    expect(participant.current_step_id).toBe("camp-1-invite");
    expect(participant.status).toBe("active");
  });
});

describe("runDueLinkedInActions — message step (C)", () => {
  it("sends the message exactly once and advances to the end step, completing the participant", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    // The executor sends exactly the persisted approved text — no
    // generation, no substitution, at send time (docs spec §10/§13).
    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-part-msg-1", "Bonjour Jane, ravi de vous compter parmi mes relations !");
    expect(participant.message_sent_at).not.toBeNull();
    expect(participant.current_step_id).toBe("camp-1-end");
    expect(participant.status).toBe("completed");
  });
});

describe("runDueLinkedInActions — end step (D)", () => {
  it("a completed participant on the end step is never reclaimed", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    fakeDatabase.campaignParticipants.push({ id: "part-done", campaign_id: "camp-1", contact_id: "contact-done", status: "completed", current_step_id: "camp-1-end", invite_sent_at: new Date().toISOString(), message_sent_at: new Date().toISOString(), step_claimed_at: null });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendLinkedInInvitationMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("runDueLinkedInActions — replied participant (E)", () => {
  it("a replied participant on the message step is never executed", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");
    participant.status = "replied";

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("runDueLinkedInActions — paused campaign (F)", () => {
  it("takes no action at all on a non-active campaign", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1", "paused");
    seedParticipantOnInviteStep("camp-1");

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0, blockedReason: "CAMPAIGN_PAUSED" });
    expect(sendLinkedInInvitationMock).not.toHaveBeenCalled();
  });
});

describe("runDueLinkedInActions — pre-send re-check race condition (G)", () => {
  it("does not call the provider when the participant replies after being claimed but before the send", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");

    // Simulates a reply landing in the exact gap between claim and send:
    // claiming already happened (participant was 'active' at that point,
    // proving the claim itself was legitimate) — the race is reproduced by
    // flipping status to 'replied' precisely when the pre-send re-check
    // queries fresh state, proving that check reads live data rather than
    // whatever the claim step already knew.
    const originalQuery = fakeDatabase.query;
    let intercepted = false;
    fakeDatabase.query = async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (!intercepted && text.startsWith("select status,current_step_id from campaign_participants where id=$1") && params[0] === participant.id) {
        intercepted = true;
        participant.status = "replied";
      }
      return originalQuery(sql, params);
    };

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(intercepted).toBe(true);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 1, failed: 0 });
  });
});

describe("runDueLinkedInActions — idempotence across repeated runs (H)", () => {
  it("does not re-claim or double-send an invite already sent", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    seedParticipantOnInviteStep("camp-1");

    await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });
    sendLinkedInInvitationMock.mockClear();
    const second = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(second).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendLinkedInInvitationMock).not.toHaveBeenCalled();
  });

  it("does not re-claim or double-send a message already sent", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    seedParticipantOnMessageStep("camp-1");

    await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });
    sendMessageMock.mockClear();
    const second = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(second).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("runDueLinkedInActions — provider error (J)", () => {
  it("leaves invite retry-eligible, records the reason, and never advances the step on failure", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnInviteStep("camp-1");
    sendLinkedInInvitationMock.mockRejectedValueOnce(new Error("Unipile down"));

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(participant.invite_sent_at).toBeNull();
    expect(participant.step_claimed_at).toBeNull();
    expect(participant.last_error_code).toBe("PROVIDER_ERROR");
    expect(participant.current_step_id).toBe("camp-1-invite");
  });

  it("leaves message retry-eligible and never advances to end on failure", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");
    sendMessageMock.mockRejectedValueOnce(new Error("Unipile down"));

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(participant.message_sent_at).toBeNull();
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe("camp-1-message");
  });
});

describe("runDueLinkedInActions — workspace isolation (K)", () => {
  it("the daily invite budget is scoped to this workspace only", async () => {
    process.env.LINKEDIN_DAILY_INVITE_LIMIT = "1";
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    const participant = seedParticipantOnInviteStep("camp-1");
    fakeDatabase.campaigns.push({ id: "camp-other-ws", workspace_id: "ws-2", status: "active" });
    fakeDatabase.campaignParticipants.push({ id: "part-other-ws", campaign_id: "camp-other-ws", contact_id: "contact-other-ws", status: "completed", current_step_id: null, invite_sent_at: new Date().toISOString(), step_claimed_at: null });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    expect(participant.invite_sent_at).not.toBeNull();
  });

  it("a campaign in another workspace is never touched by a run scoped to this one", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    seedParticipantOnInviteStep("camp-1");
    fakeDatabase.campaigns.push({ id: "camp-ws2", workspace_id: "ws-2", status: "active" });
    fakeDatabase.campaignSteps.push({ id: "camp-ws2-invite", campaign_id: "camp-ws2", position: 0, step_type: "invite", message_template: null });
    fakeDatabase.candidates.push({ id: "cand-ws2", workspace_id: "ws-2", campaign_id: "camp-ws2", provider_id: "prov-ws2", name: "Other Workspace", headline: null, status: "approved", contact_id: "contact-ws2" });
    fakeDatabase.campaignParticipants.push({ id: "part-ws2", campaign_id: "camp-ws2", contact_id: "contact-ws2", status: "active", current_step_id: "camp-ws2-invite", invite_sent_at: null, step_claimed_at: null });

    await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    const otherWorkspaceParticipant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-ws2")!;
    expect(otherWorkspaceParticipant.invite_sent_at).toBeNull();
  });
});

describe("runDueLinkedInActions — approved-message guard (Phase 3 J/K)", () => {
  it("J. sends exactly the persisted approved invitation text", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    seedParticipantOnInviteStep("camp-1");

    await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(sendLinkedInInvitationMock).toHaveBeenCalledWith(expect.anything(), "acct-1", "prov-1", "Bonjour Awa, ravi d'échanger !");
  });

  it("K. an invite step with no approved invitation text is never sent to the provider", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    fakeDatabase.candidates.push({ id: "cand-part-2", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-2", name: "Bob Martin", headline: null, status: "approved", contact_id: "contact-part-2" });
    fakeDatabase.campaignParticipants.push({ id: "part-2", campaign_id: "camp-1", contact_id: "contact-part-2", status: "active", current_step_id: "camp-1-invite", invite_sent_at: null, message_sent_at: null, step_claimed_at: null, personalization: null });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(sendLinkedInInvitationMock).not.toHaveBeenCalled();
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-2")!;
    expect(participant.last_error_code).toBe("MESSAGE_NOT_APPROVED");
    expect(participant.invite_sent_at).toBeNull();
  });

  it("K. a message step with no approved message text is never sent to the provider, and the participant does not silently advance", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    fakeDatabase.conversations.push({ id: "conv-part-2", workspace_id: workspaceId, contact_id: "contact-part-2", channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({ id: "part-2", campaign_id: "camp-1", contact_id: "contact-part-2", status: "active", current_step_id: "camp-1-message", invite_sent_at: new Date().toISOString(), invite_accepted_at: new Date().toISOString(), message_sent_at: null, step_claimed_at: null, personalization: null });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(sendMessageMock).not.toHaveBeenCalled();
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-2")!;
    expect(participant.last_error_code).toBe("MESSAGE_NOT_APPROVED");
    expect(participant.message_sent_at).toBeNull();
    expect(participant.status).toBe("active"); // never fabricated a 'completed' advance
    expect(participant.current_step_id).toBe("camp-1-message");
  });

  it("K. a generated-but-not-yet-approved message is still never sent", async () => {
    seedConnectedAccount();
    seedCampaignWithSteps("camp-1");
    fakeDatabase.conversations.push({ id: "conv-part-2", workspace_id: workspaceId, contact_id: "contact-part-2", channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({
      id: "part-2", campaign_id: "camp-1", contact_id: "contact-part-2", status: "active", current_step_id: "camp-1-message", invite_sent_at: new Date().toISOString(), invite_accepted_at: new Date().toISOString(), message_sent_at: null, step_claimed_at: null,
      personalization: { evidence: { facts: [], uncertainties: [] }, outreachAngle: null, invitation: EMPTY_TEXT, messages: [{ stepId: "camp-1-message", status: "generated", generatedText: "Un brouillon jamais validé.", editedText: null, approvedText: null, approvedAt: null }], generatedAt: new Date().toISOString(), aiModel: null },
    });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

// invite(0) -> message(1) -> wait(2) -> follow-up(3) -> end(4) — a follow-up
// is claimed and executed through the exact same 'message' step_type path
// as the first message (docs spec §9); nothing here is follow-up-specific.
function seedCampaignWithFollowUpStep(campaignId: string, status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-invite`, campaign_id: campaignId, position: 0, step_type: "invite", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-message`, campaign_id: campaignId, position: 1, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 2, step_type: "wait", delay_value: 3, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-followup`, campaign_id: campaignId, position: 3, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 4, step_type: "end", message_template: null });
}

describe("runDueLinkedInActions — follow-up step (J, K, M)", () => {
  it("J. sends exactly the approvedText mapped to the follow-up's own stepId, not the first message's", async () => {
    seedConnectedAccount();
    seedCampaignWithFollowUpStep("camp-1");
    fakeDatabase.conversations.push({ id: "conv-part-1", workspace_id: workspaceId, contact_id: "contact-part-1", channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({
      id: "part-1", campaign_id: "camp-1", contact_id: "contact-part-1", status: "active", current_step_id: "camp-1-followup", invite_sent_at: new Date().toISOString(), invite_accepted_at: new Date().toISOString(), message_sent_at: null, step_claimed_at: null,
      personalization: {
        evidence: { observedFacts: [], qualificationContext: null, strategyContext: null, uncertainties: [] },
        outreachAngle: null,
        invitation: EMPTY_TEXT,
        messages: [
          { stepId: "camp-1-message", ...EMPTY_TEXT, status: "approved", generatedText: "Texte du message 1.", approvedText: "Texte du message 1.", approvedAt: new Date().toISOString() },
          { stepId: "camp-1-followup", ...EMPTY_TEXT, status: "approved", generatedText: "Texte de la relance.", approvedText: "Texte de la relance.", approvedAt: new Date().toISOString() },
        ],
        generatedAt: new Date().toISOString(), aiModel: null,
      },
    });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    // M: the follow-up's own text is sent — never message #1's.
    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-part-1", "Texte de la relance.");
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")!;
    expect(participant.current_step_id).toBe("camp-1-end");
  });

  it("K. a generated-but-not-approved follow-up is never sent, and the participant does not advance", async () => {
    seedConnectedAccount();
    seedCampaignWithFollowUpStep("camp-1");
    fakeDatabase.conversations.push({ id: "conv-part-1", workspace_id: workspaceId, contact_id: "contact-part-1", channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({
      id: "part-1", campaign_id: "camp-1", contact_id: "contact-part-1", status: "active", current_step_id: "camp-1-followup", invite_sent_at: new Date().toISOString(), invite_accepted_at: new Date().toISOString(), message_sent_at: null, step_claimed_at: null,
      personalization: {
        evidence: { observedFacts: [], qualificationContext: null, strategyContext: null, uncertainties: [] },
        outreachAngle: null,
        invitation: EMPTY_TEXT,
        messages: [
          { stepId: "camp-1-message", ...EMPTY_TEXT, status: "approved", generatedText: "Texte du message 1.", approvedText: "Texte du message 1.", approvedAt: new Date().toISOString() },
          { stepId: "camp-1-followup", ...EMPTY_TEXT, status: "generated", generatedText: "Brouillon de relance jamais validé.", approvedText: null, approvedAt: null },
        ],
        generatedAt: new Date().toISOString(), aiModel: null,
      },
    });

    const result = await runDueLinkedInActions(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(sendMessageMock).not.toHaveBeenCalled();
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")!;
    expect(participant.last_error_code).toBe("MESSAGE_NOT_APPROVED");
    expect(participant.current_step_id).toBe("camp-1-followup");
  });
});

describe("linkedInExecutor.runDueActions", () => {
  it("delegates to runDueLinkedInActions, honoring the requested limit", async () => {
    seedConnectedAccount();
    seedParticipantOnInviteStep("camp-1");
    seedCampaignWithSteps("camp-1");

    const result = await linkedInExecutor.runDueActions(context, "camp-1", { limit: 1 });

    expect(result.sent).toBe(1);
  }, 10_000);
});

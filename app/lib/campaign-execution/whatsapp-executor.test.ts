import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "../workspace-context";

// Fake DB by SQL prefix — same approach as linkedin-executor.test.ts. Covers
// the WhatsApp executor AND step-progression.ts (exercised for real).
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };

    if (text.startsWith("select exists(select 1 from connections where workspace_id=$1 and provider='unipile' and channel_type='whatsapp'")) {
      const [workspaceId] = params as string[];
      const connected = connections.some((c) => c.workspace_id === workspaceId && c.channel_type === "whatsapp" && c.status === "connected");
      return { rows: [{ connected }] };
    }
    if (text.startsWith("select status from campaigns")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.workspace_id === workspaceId && c.id === campaignId);
      return { rows: row ? [{ status: row.status }] : [] };
    }
    if (text.startsWith("select step_type from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").map((s) => ({ step_type: s.step_type })) };
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
    if (text.startsWith("select status,current_step_id from campaign_participants where id=$1")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      return { rows: row ? [{ status: row.status, current_step_id: row.current_step_id }] : [] };
    }
    if (text.startsWith("select p.personalization from campaign_participants p join campaigns c")) {
      const [workspaceId, campaignId, participantId] = params as string[];
      const campaign = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      const row = campaignParticipants.find((p) => p.id === participantId && p.campaign_id === campaignId);
      if (!campaign || !row) return { rows: [] };
      return { rows: [{ personalization: row.personalization ?? null }] };
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
    // Generalized findConversationId — channel_type is a real bound
    // parameter now, not a literal, which is exactly what §2's guard test
    // below depends on.
    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2 and channel_type=$3")) {
      const [workspaceId, contactId, channelType] = params as string[];
      const row = conversations.find((c) => c.workspace_id === workspaceId && c.contact_id === contactId && c.channel_type === channelType);
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
      if (row) { row.current_step_id = nextStepId ?? row.current_step_id; row.status = "completed"; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=$1,step_claimed_at=null")) {
      const [nextStepId, id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("insert into activities")) {
      const row = { id: nextId("activity") };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: new Date().toISOString() }] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, campaigns, campaignSteps, campaignParticipants, conversations, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

vi.mock("../providers/unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
}));
const sendMessageMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg-1", body: "", direction: "outbound" as const, status: "sent" as const, createdAt: new Date().toISOString() })));
vi.mock("../providers/unipile-adapter", () => ({ sendMessage: sendMessageMock }));
vi.mock("../ai", () => ({ getAIProvider: () => null }));
vi.mock("../business-context/business-context-service", () => ({ getActiveBusinessContext: async () => null }));

const { runDueWhatsAppActions, whatsAppExecutor } = await import("./whatsapp-executor");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  sendMessageMock.mockClear();
});

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function seedConnectedWhatsAppAccount(forWorkspaceId = workspaceId) {
  fakeDatabase.connections.push({ workspace_id: forWorkspaceId, provider: "unipile", channel_type: "whatsapp", external_account_id: "wa-acct-1", status: "connected" });
}

// message(0) -> end(1) — canonical shape for a minimal WhatsApp sequence,
// no invite step, matching CampaignsClient.tsx's non-prospecting wizard.
function seedCampaign(campaignId: string, status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-message`, campaign_id: campaignId, position: 0, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 1, step_type: "end", message_template: null });
}

const EMPTY_TEXT = { status: "not_generated", generatedText: null, editedText: null, approvedText: null, approvedAt: null };
function approvedPersonalization(messageStepId: string, approvedMessageText: string) {
  return {
    evidence: { observedFacts: [], qualificationContext: null, strategyContext: null, uncertainties: [] },
    outreachAngle: null,
    invitation: { ...EMPTY_TEXT },
    messages: [{ stepId: messageStepId, ...EMPTY_TEXT, status: "approved", generatedText: approvedMessageText, approvedText: approvedMessageText, approvedAt: new Date().toISOString() }],
    generatedAt: new Date().toISOString(),
    aiModel: null,
  };
}

function seedParticipantOnMessageStep(campaignId: string, participantId = "part-1", approvedText = "Bonjour Jean, je me permets de revenir vers vous.") {
  fakeDatabase.conversations.push({ id: `conv-wa-${participantId}`, workspace_id: workspaceId, contact_id: `contact-${participantId}`, channel_type: "whatsapp", last_message_at: null, created_at: new Date().toISOString() });
  fakeDatabase.campaignParticipants.push({
    id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status: "active", current_step_id: `${campaignId}-message`, message_sent_at: null, step_claimed_at: null,
    personalization: approvedPersonalization(`${campaignId}-message`, approvedText),
  });
  return fakeDatabase.campaignParticipants[fakeDatabase.campaignParticipants.length - 1]!;
}

describe("runDueWhatsAppActions — no WhatsApp connection", () => {
  it("blocks with NO_WHATSAPP_CONNECTION when no connected WhatsApp account exists", async () => {
    seedCampaign("camp-1");
    seedParticipantOnMessageStep("camp-1");

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0, blockedReason: "NO_WHATSAPP_CONNECTION" });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("runDueWhatsAppActions — message step (A)", () => {
  it("sends the approved message exactly once and advances to the end step", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-wa-part-1", "Bonjour Jean, je me permets de revenir vers vous.", "part-1:camp-1-message");
    expect(participant.message_sent_at).not.toBeNull();
    expect(participant.current_step_id).toBe("camp-1-end");
    expect(participant.status).toBe("completed");
  });
});

describe("runDueWhatsAppActions — conversation resolution guard (§2)", () => {
  it("a Contact with both a LinkedIn and a WhatsApp conversation only ever uses the WhatsApp one", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    // The SAME contact_id has a LinkedIn conversation too — seeded first, so
    // a channel-blind lookup would find it before the WhatsApp one.
    fakeDatabase.conversations.push({ id: "conv-linkedin-part-1", workspace_id: workspaceId, contact_id: "contact-part-1", channel_type: "linkedin", last_message_at: null, created_at: new Date(Date.now() - 10_000).toISOString() });
    const participant = seedParticipantOnMessageStep("camp-1", "part-1", "Message WhatsApp réel.");

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    // Exactly the WhatsApp conversation id — never the LinkedIn one for the
    // same contact.
    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-wa-part-1", "Message WhatsApp réel.", "part-1:camp-1-message");
    expect(participant.current_step_id).toBe("camp-1-end");
  });
});

describe("runDueWhatsAppActions — WhatsApp conversation absent (§2/§6)", () => {
  it("fails in a controlled way and never falls back to a LinkedIn conversation for the same contact", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    // No WhatsApp conversation seeded — only a LinkedIn one for the same
    // contact, which must never be picked up as a substitute.
    fakeDatabase.conversations.push({ id: "conv-linkedin-part-1", workspace_id: workspaceId, contact_id: "contact-part-1", channel_type: "linkedin", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({
      id: "part-1", campaign_id: "camp-1", contact_id: "contact-part-1", status: "active", current_step_id: "camp-1-message", message_sent_at: null, step_claimed_at: null,
      personalization: approvedPersonalization("camp-1-message", "Texte approuvé."),
    });

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(sendMessageMock).not.toHaveBeenCalled();
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")!;
    expect(participant.last_error_code).toBe("NOT_ELIGIBLE");
    expect(participant.message_sent_at).toBeNull();
  });
});

describe("runDueWhatsAppActions — replied participant (B)", () => {
  it("a replied participant is never executed", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");
    participant.status = "replied";

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("runDueWhatsAppActions — paused campaign (C)", () => {
  it("takes no action at all on a non-active campaign", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1", "paused");
    seedParticipantOnMessageStep("camp-1");

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0, blockedReason: "CAMPAIGN_PAUSED" });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("runDueWhatsAppActions — MESSAGE_NOT_APPROVED (D)", () => {
  it("a message step with no approved text is never sent, and the participant does not silently advance", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    fakeDatabase.conversations.push({ id: "conv-wa-part-1", workspace_id: workspaceId, contact_id: "contact-part-1", channel_type: "whatsapp", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-part-1", status: "active", current_step_id: "camp-1-message", message_sent_at: null, step_claimed_at: null, personalization: null });

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(sendMessageMock).not.toHaveBeenCalled();
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")!;
    expect(participant.last_error_code).toBe("MESSAGE_NOT_APPROVED");
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe("camp-1-message");
  });
});

describe("runDueWhatsAppActions — workspace isolation (E)", () => {
  it("a campaign in another workspace is never touched by a run scoped to this one", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    seedParticipantOnMessageStep("camp-1");
    fakeDatabase.campaigns.push({ id: "camp-ws2", workspace_id: "ws-2", status: "active" });
    fakeDatabase.campaignSteps.push({ id: "camp-ws2-message", campaign_id: "camp-ws2", position: 0, step_type: "message", message_template: null });
    fakeDatabase.conversations.push({ id: "conv-ws2", workspace_id: "ws-2", contact_id: "contact-ws2", channel_type: "whatsapp", last_message_at: null, created_at: new Date().toISOString() });
    fakeDatabase.campaignParticipants.push({ id: "part-ws2", campaign_id: "camp-ws2", contact_id: "contact-ws2", status: "active", current_step_id: "camp-ws2-message", message_sent_at: null, step_claimed_at: null, personalization: approvedPersonalization("camp-ws2-message", "Texte ws2.") });

    await runDueWhatsAppActions(context, "camp-1");

    const otherWorkspaceParticipant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-ws2")!;
    expect(otherWorkspaceParticipant.message_sent_at).toBeNull();
    expect(sendMessageMock).not.toHaveBeenCalledWith("ws-2", expect.anything(), expect.anything());
  });
});

describe("runDueWhatsAppActions — provider error (G)", () => {
  it("leaves the message retry-eligible and never advances the step on failure", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    const participant = seedParticipantOnMessageStep("camp-1");
    sendMessageMock.mockRejectedValueOnce(new Error("Unipile down"));

    const result = await runDueWhatsAppActions(context, "camp-1");

    expect(result).toEqual({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(participant.message_sent_at).toBeNull();
    expect(participant.status).toBe("active");
    expect(participant.current_step_id).toBe("camp-1-message");
  });
});

describe("runDueWhatsAppActions — idempotence across repeated runs (H)", () => {
  it("does not re-claim or double-send a message already sent", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    seedParticipantOnMessageStep("camp-1");

    await runDueWhatsAppActions(context, "camp-1");
    sendMessageMock.mockClear();
    const second = await runDueWhatsAppActions(context, "camp-1");

    expect(second).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("whatsAppExecutor.runDueActions", () => {
  it("delegates to runDueWhatsAppActions, honoring the requested limit", async () => {
    seedConnectedWhatsAppAccount();
    seedCampaign("camp-1");
    seedParticipantOnMessageStep("camp-1");

    const result = await whatsAppExecutor.runDueActions(context, "camp-1", { limit: 1 });

    expect(result.sent).toBe(1);
  });
});

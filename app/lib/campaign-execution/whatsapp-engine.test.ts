import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "../workspace-context";

// Combined fake DB — the WhatsApp analogue of engine.test.ts's LinkedIn one.
// runDueCampaignActions calls BOTH consumeDueWaitSteps() and
// runDueWhatsAppActions() against the same `database` mock in one call, so
// this file exists specifically to prove the exact race the "WhatsApp
// minimal" spec §5 calls out end to end, not as two independently-passing
// halves.
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
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

    if (text.startsWith("select channel_type,objective from campaigns where workspace_id=$1 and id=$2")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      return { rows: row ? [{ channel_type: row.channel_type, objective: row.objective }] : [] };
    }
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
    // --- whatsapp-executor.ts ---
    if (text.startsWith("select exists(select 1 from connections where workspace_id=$1 and provider='unipile' and channel_type='whatsapp'")) {
      const [workspaceId] = params as string[];
      const connected = connections.some((c) => c.workspace_id === workspaceId && c.channel_type === "whatsapp" && c.status === "connected");
      return { rows: [{ connected }] };
    }
    if (text.startsWith("select step_type from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").map((s) => ({ step_type: s.step_type })) };
    }
    // The message claim (executor-shared.ts's claimByStepType).
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
    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2 and channel_type=$3")) {
      const [workspaceId, contactId, channelType] = params as string[];
      const row = conversations.find((c) => c.workspace_id === workspaceId && c.contact_id === contactId && c.channel_type === channelType);
      return { rows: row ? [{ id: row.id }] : [] };
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

const { runDueCampaignActions } = await import("./engine");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  sendMessageMock.mockClear();
});

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function ago(ms: number): string { return new Date(Date.now() - ms).toISOString(); }
const DAY = 86_400_000;

const EMPTY_TEXT = { status: "not_generated", generatedText: null, editedText: null, approvedText: null, approvedAt: null };

function seedConnectedWhatsAppAccount() {
  fakeDatabase.connections.push({ workspace_id: workspaceId, provider: "unipile", channel_type: "whatsapp", external_account_id: "wa-acct-1", status: "connected" });
}

// message1(0) -> wait 3d(1) -> message2(2) -> end(3), no invite step —
// matches CampaignsClient.tsx's non-prospecting WhatsApp sequence.
function seedSequence(campaignId: string) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status: "active", channel_type: "whatsapp", objective: "follow_up" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 0, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 1, step_type: "wait", delay_value: 3, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg2`, campaign_id: campaignId, position: 2, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 3, step_type: "end", message_template: null });
}

// Message #1 already sent, participant on the due WAIT step, message #2
// already approved — everything primed to send the instant the WAIT is
// consumed, which is exactly the window this test probes.
function seedParticipantOnDueWait(campaignId: string, participantId: string) {
  fakeDatabase.conversations.push({ id: `conv-wa-${participantId}`, workspace_id: workspaceId, contact_id: `contact-${participantId}`, channel_type: "whatsapp", last_message_at: null, created_at: new Date().toISOString() });
  fakeDatabase.campaignParticipants.push({
    id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status: "active", current_step_id: `${campaignId}-wait`,
    message_sent_at: null, step_claimed_at: null, last_action_at: ago(3 * DAY + 60_000),
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

describe("runDueCampaignActions (WhatsApp) — combined E2E: WAIT consumed then message sent (baseline)", () => {
  it("consumes the WAIT and sends message #2 in the same call when nothing interferes", async () => {
    seedConnectedWhatsAppAccount();
    seedSequence("camp-1");
    const participant = seedParticipantOnDueWait("camp-1", "part-1");

    await runDueCampaignActions(context, "camp-1");

    expect(sendMessageMock).toHaveBeenCalledWith(workspaceId, "conv-wa-part-1", "Message 2 approuvé.", "part-1:camp-1-msg2");
    expect(participant.current_step_id).toBe("camp-1-end");
    expect(participant.status).toBe("completed");
  });
});

describe("runDueCampaignActions (WhatsApp) — reply lands after WAIT consumption, before provider call (§5)", () => {
  it("WAIT consumed -> message #2 current -> reply commits after reverifyEligibility but before send -> provider never called", async () => {
    seedConnectedWhatsAppAccount();
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
        // 1st: consumeDueWaitSteps's own fresh check (still active — the
        // WAIT genuinely gets consumed). 2nd: reverifyEligibility inside
        // runDueWhatsAppActions — still active here, proving the reply
        // truly lands after it. Only after this 2nd read do we flip the
        // participant to 'replied', so the 3rd occurrence
        // (checkParticipantStillActive, the final pre-send check) is the
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
    expect(statusReadCount).toBeGreaterThanOrEqual(3);
    // The WAIT itself was still legitimately consumed (it elapsed before any
    // reply existed) — the participant is on message #2, not stuck on WAIT.
    expect(participant.current_step_id).toBe("camp-1-msg2");
    expect(participant.status).toBe("replied");
    // The one invariant this whole test exists to prove:
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

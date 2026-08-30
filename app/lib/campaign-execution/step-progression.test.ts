import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake DB by SQL prefix — same approach as linkedin-executor.test.ts. Covers
// campaigns/campaign_steps/campaign_participants/activities, enough for
// advanceParticipantToNextStep and consumeDueWaitSteps end to end. `now()`
// literals in the real SQL are evaluated here in plain JS against each row's
// own persisted timestamps (last_action_at, step_claimed_at) — no injected
// clock needed (docs spec §33): a WAIT's due-ness is controlled entirely by
// how far in the past a test backdates last_action_at, never by a sleep.
function createFakeDatabase() {
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
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

    if (text.startsWith("select status from campaigns where workspace_id=$1 and id=$2")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.workspace_id === workspaceId && c.id === campaignId);
      return { rows: row ? [{ status: row.status }] : [] };
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
    if (text.startsWith("insert into activities")) {
      const row = { id: nextId("activity") };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: new Date().toISOString() }] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), campaigns, campaignSteps, campaignParticipants, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

const { advanceParticipantToNextStep, consumeDueWaitSteps } = await import("./step-progression");

beforeEach(() => { fakeDatabase = createFakeDatabase(); });

const workspaceId = "ws-1";

function ago(ms: number): string { return new Date(Date.now() - ms).toISOString(); }
const DAY = 86_400_000;

// invite(0) -> message(1) -> wait 3d(2) -> message "follow-up 1"(3) -> wait 4d(4) -> message "follow-up 2"(5) -> end(6)
function seedSequence(campaignId: string, status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-invite`, campaign_id: campaignId, position: 0, step_type: "invite", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 1, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait1`, campaign_id: campaignId, position: 2, step_type: "wait", delay_value: 3, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-fu1`, campaign_id: campaignId, position: 3, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait2`, campaign_id: campaignId, position: 4, step_type: "wait", delay_value: 4, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-fu2`, campaign_id: campaignId, position: 5, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 6, step_type: "end", message_template: null });
}
function seedParticipantOnWait1(campaignId: string, participantId: string, lastActionAgoMs: number, status = "active") {
  fakeDatabase.campaignParticipants.push({ id: participantId, campaign_id: campaignId, contact_id: `contact-${participantId}`, status, current_step_id: `${campaignId}-wait1`, step_claimed_at: null, last_action_at: ago(lastActionAgoMs) });
  return fakeDatabase.campaignParticipants[fakeDatabase.campaignParticipants.length - 1]!;
}

describe("advanceParticipantToNextStep — last_action_at stamping (A)", () => {
  it("A. stamps last_action_at at the moment of the transition, anchoring the following WAIT", async () => {
    seedSequence("camp-1");
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-1", status: "active", current_step_id: "camp-1-msg1", step_claimed_at: null, last_action_at: null });

    const before = Date.now();
    const result = await advanceParticipantToNextStep(workspaceId, "camp-1", "part-1", "camp-1-msg1");

    expect(result).toMatchObject({ advancedTo: "actionable", stepId: "camp-1-wait1", stepType: "wait" });
    const participant = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")!;
    expect(participant.current_step_id).toBe("camp-1-wait1");
    expect(new Date(participant.last_action_at as string).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("consumeDueWaitSteps — not yet due (B)", () => {
  it("B. a WAIT scheduled 3 days out is not consumed after only 1 day", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", DAY);

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait1");
    expect(participant.step_claimed_at).toBeNull();
  });
});

describe("consumeDueWaitSteps — due (C)", () => {
  it("C. a WAIT whose delay has elapsed advances the participant onto the next actionable step", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 1 });
    expect(participant.current_step_id).toBe("camp-1-fu1");
    expect(participant.step_claimed_at).toBeNull();
  });
});

describe("consumeDueWaitSteps — restart safety (D)", () => {
  it("D. a WAIT persisted before a simulated process restart is still honored by a fresh call", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

    // No in-memory timer exists to lose — "restart" is simply a brand new,
    // independent call against the same persisted row.
    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 1 });
    expect(participant.current_step_id).toBe("camp-1-fu1");
  });
});

describe("consumeDueWaitSteps — duplicate trigger / idempotence (E, N)", () => {
  it("E/N. a second call (simulating an overlapping worker or a duplicate cron trigger) does not re-advance an already-consumed participant", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

    const first = await consumeDueWaitSteps(workspaceId, "camp-1");
    const second = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(first).toEqual({ consumed: 1 });
    expect(second).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-fu1");
  });
});

describe("consumeDueWaitSteps — campaign paused (F)", () => {
  it("F. a due WAIT is not consumed while the campaign is paused", async () => {
    seedSequence("camp-1", "paused");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait1");
  });
});

describe("consumeDueWaitSteps — campaign resumed (G)", () => {
  it("G. once resumed, an already-elapsed WAIT becomes consumable without any calendar shift", async () => {
    seedSequence("camp-1", "paused");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

    const whilePaused = await consumeDueWaitSteps(workspaceId, "camp-1");
    fakeDatabase.campaigns.find((c) => c.id === "camp-1")!.status = "active";
    const afterResume = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(whilePaused).toEqual({ consumed: 0 });
    expect(afterResume).toEqual({ consumed: 1 });
    expect(participant.current_step_id).toBe("camp-1-fu1");
  });
});

describe("consumeDueWaitSteps — reply during WAIT (H, S)", () => {
  it("H. a participant who replied is never claimed, even with an elapsed WAIT", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000, "replied");

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait1");
  });

  it("S. a reply during the SECOND wait stops the sequence before the final follow-up", async () => {
    seedSequence("camp-1");
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-1", status: "replied", current_step_id: "camp-1-wait2", step_claimed_at: null, last_action_at: ago(4 * DAY + 60_000) });
    const participant = fakeDatabase.campaignParticipants[0]!;

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait2");
    expect(participant.status).toBe("replied");
  });
});

describe("consumeDueWaitSteps — race: reply lands after claim, before advance (I)", () => {
  it("I. a reply arriving in the gap between claim and the fresh recheck prevents the advance", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

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

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(intercepted).toBe(true);
    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait1");
  });
});

describe("consumeDueWaitSteps — END after the final follow-up (P)", () => {
  it("P. consuming the last WAIT in the sequence completes the participant, not another actionable step", async () => {
    seedSequence("camp-1");
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-1", status: "active", current_step_id: "camp-1-wait2", step_claimed_at: null, last_action_at: ago(4 * DAY + 60_000) });
    const participant = fakeDatabase.campaignParticipants[0]!;

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 1 });
    expect(participant.current_step_id).toBe("camp-1-fu2");
    expect(participant.status).toBe("active");
  });
});

describe("consumeDueWaitSteps — workspace isolation (Q)", () => {
  it("Q. a campaignId that does not belong to the calling workspace is never touched", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);

    const result = await consumeDueWaitSteps("ws-intruder", "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait1");
  });
});

describe("consumeDueWaitSteps — acceptance wait stays event-driven (R)", () => {
  it("R. a participant sitting on the 'invite' step is never claimed by the WAIT timer, no matter how long it has been", async () => {
    seedSequence("camp-1");
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-1", status: "active", current_step_id: "camp-1-invite", step_claimed_at: null, last_action_at: ago(30 * DAY) });
    const participant = fakeDatabase.campaignParticipants[0]!;

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-invite");
  });
});

// message(0) -> wait 3d(1) -> end(2) — the direct WAIT→END case, distinct
// from seedSequence's WAIT→message case above (Phase 4B §8).
function seedShortSequenceEndsAfterWait(campaignId: string) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status: "active" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg`, campaign_id: campaignId, position: 0, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 1, step_type: "wait", delay_value: 3, delay_unit: "days", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-end`, campaign_id: campaignId, position: 2, step_type: "end", message_template: null });
}

describe("consumeDueWaitSteps — WAIT immediately followed by END (Phase 4B §8)", () => {
  it("D. a due WAIT whose very next step is END completes the participant directly, with no intermediate actionable step", async () => {
    seedShortSequenceEndsAfterWait("camp-2");
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-2", contact_id: "contact-1", status: "active", current_step_id: "camp-2-wait", step_claimed_at: null, last_action_at: ago(3 * DAY + 60_000) });
    const participant = fakeDatabase.campaignParticipants[0]!;

    const result = await consumeDueWaitSteps(workspaceId, "camp-2");

    expect(result).toEqual({ consumed: 1 });
    expect(participant.current_step_id).toBe("camp-2-end");
    expect(participant.status).toBe("completed");
  });
});

describe("consumeDueWaitSteps — stale vs fresh claim recovery (Phase 4B §9)", () => {
  it("E. a WAIT claim older than 10 minutes is treated as abandoned and re-claimed, progressing correctly", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);
    participant.step_claimed_at = ago(11 * 60_000); // 11 minutes ago — stale

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 1 });
    expect(participant.current_step_id).toBe("camp-1-fu1");
  });

  it("F. a WAIT claim only a few minutes old is never re-claimed by a concurrent run", async () => {
    seedSequence("camp-1");
    const participant = seedParticipantOnWait1("camp-1", "part-1", 3 * DAY + 60_000);
    participant.step_claimed_at = ago(2 * 60_000); // 2 minutes ago — fresh, another worker is presumably still handling it

    const result = await consumeDueWaitSteps(workspaceId, "camp-1");

    expect(result).toEqual({ consumed: 0 });
    expect(participant.current_step_id).toBe("camp-1-wait1"); // untouched — still "owned" by the other claim
  });
});

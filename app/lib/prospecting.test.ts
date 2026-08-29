import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "./workspace-context";

// Fake DB by SQL prefix — same approach as unipile-adapter.test.ts and
// inbox.test.ts. Flat in-memory arrays standing in for the real tables this
// module (and findOrCreateContact, which it reuses) actually touches.
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const businessContexts: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const candidates: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const contactIdentities: Array<Record<string, unknown>> = [];
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

    if (text.startsWith("select id,status,error_reason,website,company_name")) {
      const [workspaceId] = params as string[];
      const row = businessContexts.find((c) => c.workspace_id === workspaceId && c.is_active);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("insert into campaign_prospect_candidates")) {
      const [workspaceId, campaignId, providerId, profileUrl, name, headline, company] = params as string[];
      let row = candidates.find((c) => c.campaign_id === campaignId && c.provider_id === providerId);
      if (row) { row.name = name; row.headline = headline; row.company = company; }
      else { row = { id: nextId("cand"), workspace_id: workspaceId, campaign_id: campaignId, provider_id: providerId, profile_url: profileUrl, name, headline, company, status: "suggested", contact_id: null, created_at: new Date().toISOString() }; candidates.push(row); }
      return { rows: [row] };
    }

    if (text.startsWith("select id,provider_id,name,headline,company,profile_url,status from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 order by")) {
      const [workspaceId, campaignId] = params as string[];
      return { rows: candidates.filter((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId) };
    }

    if (text.startsWith("select id,provider_id,name,headline,company,profile_url,status from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and id=$3")) {
      const [workspaceId, campaignId, id] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.id === id);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("select contact_id from contact_identities")) {
      const [workspaceId, identifierNormalized, channelType] = params as string[];
      const row = contactIdentities.find((c) => c.workspace_id === workspaceId && c.channel_type === channelType && c.identifier_normalized === identifierNormalized);
      return { rows: row ? [{ contact_id: row.contact_id }] : [] };
    }
    if (text.startsWith("update contact_identities set metadata")) return { rows: [] };
    if (text.startsWith("update contacts set job_title")) return { rows: [] };

    if (text.startsWith("insert into contacts")) {
      const [workspaceId, firstName, lastName, displayName, jobTitle] = params as string[];
      const row = { id: nextId("contact"), workspace_id: workspaceId, first_name: firstName, last_name: lastName, display_name: displayName, job_title: jobTitle ?? null, status: "new" };
      contacts.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith("insert into contact_identities")) {
      const [workspaceId, contactId, provider, identifier, identifierNormalized, profileUrl, , channelType] = params as string[];
      if (!contactIdentities.some((c) => c.workspace_id === workspaceId && c.channel_type === channelType && c.identifier_normalized === identifierNormalized)) {
        contactIdentities.push({ workspace_id: workspaceId, contact_id: contactId, channel_type: channelType, provider, identifier, identifier_normalized: identifierNormalized, profile_url: profileUrl });
      }
      return { rows: [] };
    }

    if (text.startsWith("update contacts set status='lead'")) {
      const [contactId] = params as string[];
      const row = contacts.find((c) => c.id === contactId);
      if (row && row.status === "new") row.status = "lead";
      return { rows: [] };
    }

    if (text.startsWith("update campaign_prospect_candidates set status='approved'")) {
      const [contactId, candidateId] = params as string[];
      const row = candidates.find((c) => c.id === candidateId);
      if (row) { row.status = "approved"; row.contact_id = contactId; }
      return { rows: [] };
    }

    if (text.startsWith("insert into campaign_participants")) {
      const [campaignId, contactId] = params as string[];
      if (!campaignParticipants.some((p) => p.campaign_id === campaignId && p.contact_id === contactId)) {
        campaignParticipants.push({ id: nextId("part"), campaign_id: campaignId, contact_id: contactId, status: "waiting", current_step_id: null, invite_claimed_at: null, invite_sent_at: null, invite_accepted_at: null, created_at: new Date().toISOString() });
      }
      return { rows: [] };
    }

    if (text.startsWith("update campaign_participants set current_step_id=(select id from campaign_steps")) {
      const [campaignId] = params as string[];
      const firstStep = campaignSteps.filter((s) => s.campaign_id === campaignId).sort((a, b) => (a.position as number) - (b.position as number))[0];
      for (const p of campaignParticipants) if (p.campaign_id === campaignId && p.current_step_id === null) p.current_step_id = firstStep?.id ?? null;
      return { rows: [] };
    }

    if (text.startsWith("insert into activities")) {
      const row = { id: nextId("activity") };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: new Date().toISOString() }] };
    }

    if (text.startsWith("select status from campaigns")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.workspace_id === workspaceId && c.id === campaignId);
      return { rows: row ? [{ status: row.status }] : [] };
    }

    if (text.startsWith("select id from campaign_steps where campaign_id=$1 and step_type='invite'")) {
      const [campaignId] = params as string[];
      const row = campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "invite").sort((a, b) => (a.position as number) - (b.position as number))[0];
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (text.startsWith("select id,message_template from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      const row = campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").sort((a, b) => (a.position as number) - (b.position as number))[0];
      return { rows: row ? [{ id: row.id, message_template: row.message_template }] : [] };
    }

    if (text.startsWith("update campaign_participants set invite_claimed_at=now() where id in")) {
      const [campaignId, stepId, limit] = params as [string, string, number];
      const eligible = campaignParticipants
        .filter((p) => p.campaign_id === campaignId && p.status === "active" && p.current_step_id === stepId && !p.invite_sent_at && !p.invite_claimed_at)
        .slice(0, limit);
      for (const p of eligible) p.invite_claimed_at = new Date().toISOString();
      return { rows: eligible.map((p) => ({ id: p.id, contact_id: p.contact_id })) };
    }

    if (text.startsWith("select provider_id,name,headline from campaign_prospect_candidates")) {
      const [workspaceId, campaignId, contactId] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.contact_id === contactId && c.status === "approved");
      return { rows: row ? [{ provider_id: row.provider_id, name: row.name, headline: row.headline }] : [] };
    }

    if (text.startsWith("update campaign_participants set invite_sent_at=now()")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) row.invite_sent_at = new Date().toISOString();
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set invite_claimed_at=null")) {
      const [id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) row.invite_claimed_at = null;
      return { rows: [] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, businessContexts, campaigns, campaignSteps, campaignParticipants, candidates, contacts, contactIdentities, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("./database", () => ({ get database() { return fakeDatabase; } }));

const searchLinkedInPeopleMock = vi.hoisted(() => vi.fn());
const sendLinkedInInvitationMock = vi.hoisted(() => vi.fn(async () => "invitation-1"));
vi.mock("./providers/unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  searchLinkedInPeople: searchLinkedInPeopleMock,
  sendLinkedInInvitation: sendLinkedInInvitationMock,
}));

// No AI key configured — tests exercise the deterministic template fallback,
// not a live model call.
vi.mock("./ai", () => ({ getAIProvider: () => null }));

const { approveProspects, listCandidates, searchProspects, sendInviteBatch } = await import("./prospecting");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  searchLinkedInPeopleMock.mockClear();
  sendLinkedInInvitationMock.mockClear();
});

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function seedConnectedAccount() {
  fakeDatabase.connections.push({ workspace_id: workspaceId, provider: "unipile", channel_type: "linkedin", external_account_id: "acct-1", status: "connected" });
}
function seedCampaign(campaignId: string, status = "active") {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, status });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-invite`, campaign_id: campaignId, position: 0, step_type: "invite", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-message`, campaign_id: campaignId, position: 1, step_type: "message", message_template: "Ravi de vous compter parmi mes relations !" });
}

describe("searchProspects", () => {
  it("stores search results as review candidates without creating any Contact", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-1", name: "Awa Traoré", headline: "Directrice marketing", profile_url: "https://linkedin.com/in/awa", current_positions: [{ company: "Acme" }] }], cursor: null });

    const result = await searchProspects(context, "camp-1", "growth");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerId: "prov-1", name: "Awa Traoré", status: "suggested" });
    expect(fakeDatabase.contacts).toHaveLength(0);
    const listed = await listCandidates(context, "camp-1");
    expect(listed).toHaveLength(1);
  });
});

describe("approveProspects", () => {
  it("creates a lead Contact and a waiting participant for an approved candidate", async () => {
    seedCampaign("camp-1");
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://linkedin.com/in/awa", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });

    const result = await approveProspects(context, "camp-1", ["cand-1"]);

    expect(result.approved).toBe(1);
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.contacts[0]).toMatchObject({ status: "lead" });
    expect(fakeDatabase.campaignParticipants).toHaveLength(1);
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ campaign_id: "camp-1", status: "waiting", current_step_id: "camp-1-invite" });
  });

  it("resolves to the same Contact a candidate was already dedup'd to, instead of duplicating it", async () => {
    seedCampaign("camp-1");
    fakeDatabase.contacts.push({ id: "contact-existing", workspace_id: workspaceId, display_name: "Awa Traoré", status: "qualified" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-existing", channel_type: "linkedin", identifier_normalized: "linkedin.com/in/awa" });
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://www.linkedin.com/in/awa/", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });

    await approveProspects(context, "camp-1", ["cand-1"]);

    expect(fakeDatabase.contacts).toHaveLength(1);
    // Already-qualified contact must not be reset to 'lead' just because a
    // prospecting search happened to also find them.
    expect(fakeDatabase.contacts[0]).toMatchObject({ status: "qualified" });
  });
});

describe("sendInviteBatch", () => {
  async function approvedParticipant(campaignId: string) {
    seedConnectedAccount();
    seedCampaign(campaignId);
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: campaignId, provider_id: "prov-1", profile_url: "https://linkedin.com/in/awa", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });
    await approveProspects(context, campaignId, ["cand-1"]);
    const participant = fakeDatabase.campaignParticipants[0]!;
    participant.status = "active"; // campaign activation flips waiting -> active
    return participant;
  }

  it("sends an invitation and marks the participant sent", async () => {
    await approvedParticipant("camp-1");
    const result = await sendInviteBatch(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sendLinkedInInvitationMock).toHaveBeenCalledWith(expect.anything(), "acct-1", "prov-1", expect.any(String));
    expect(fakeDatabase.campaignParticipants[0]!.invite_sent_at).not.toBeNull();
  });

  it("respects the batch limit, leaving the rest eligible for a later click", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    for (let i = 0; i < 3; i += 1) {
      fakeDatabase.candidates.push({ id: `cand-${i}`, workspace_id: workspaceId, campaign_id: "camp-1", provider_id: `prov-${i}`, profile_url: `https://linkedin.com/in/p${i}`, name: `Prospect ${i}`, headline: null, company: null, status: "suggested", contact_id: null });
    }
    await approveProspects(context, "camp-1", ["cand-0", "cand-1", "cand-2"]);
    for (const p of fakeDatabase.campaignParticipants) p.status = "active";

    const result = await sendInviteBatch(context, "camp-1", 2, { min: 0, spread: 0 });

    expect(result).toEqual({ sent: 2, failed: 0 });
    const stillPending = fakeDatabase.campaignParticipants.filter((p) => !p.invite_sent_at);
    expect(stillPending).toHaveLength(1);
  });

  it("leaves a failed send retry-eligible instead of fabricating success", async () => {
    const participant = await approvedParticipant("camp-1");
    sendLinkedInInvitationMock.mockRejectedValueOnce(new Error("Unipile down"));

    const result = await sendInviteBatch(context, "camp-1", undefined, { min: 0, spread: 0 });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(participant.invite_sent_at).toBeNull();
    expect(participant.invite_claimed_at).toBeNull();
  });

  it("refuses to send on a campaign that isn't activated", async () => {
    await approvedParticipant("camp-1");
    fakeDatabase.campaigns[0]!.status = "draft";

    await expect(sendInviteBatch(context, "camp-1", undefined, { min: 0, spread: 0 })).rejects.toThrow();
    expect(sendLinkedInInvitationMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "./workspace-context";
import type { CampaignStrategy } from "./campaign-strategy";

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
      const [workspaceId, campaignId, providerId, profileUrl, name, headline, company, location, role] = params as string[];
      let row = candidates.find((c) => c.campaign_id === campaignId && c.provider_id === providerId);
      if (row) { row.name = name; row.headline = headline; row.company = company; row.location = location; row.role = role; }
      else { row = { id: nextId("cand"), workspace_id: workspaceId, campaign_id: campaignId, provider_id: providerId, profile_url: profileUrl, name, headline, company, location, role, status: "suggested", contact_id: null, qualification: null, created_at: new Date().toISOString() }; candidates.push(row); }
      return { rows: [row] };
    }

    if (text.startsWith("select cd.id,cd.provider_id,cd.name,cd.headline,cd.company,cd.location,cd.role,cd.profile_url,cd.status,cd.qualification,p.id participant_id")) {
      const [workspaceId, campaignId] = params as string[];
      return {
        rows: candidates.filter((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId).map((c) => {
          const participant = campaignParticipants.find((p) => p.campaign_id === campaignId && p.contact_id === c.contact_id);
          return { ...c, participant_id: participant?.id ?? null };
        }),
      };
    }

    if (text.startsWith("select id,provider_id,name,headline,company,location,role,profile_url,status,qualification from campaign_prospect_candidates where workspace_id=$1 and campaign_id=$2 and id=$3")) {
      const [workspaceId, campaignId, id] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.id === id);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("update campaign_prospect_candidates set qualification=$1")) {
      const [qualification, workspaceId, campaignId, id] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.id === id);
      if (row) row.qualification = JSON.parse(qualification);
      return { rows: [] };
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

    // `returning id` is what lets approveProspects tell a genuinely new
    // participant from an ON CONFLICT no-op — only a fresh, ACTIVE one is
    // ever initialized onto the first step.
    if (text.startsWith("insert into campaign_participants")) {
      const [campaignId, contactId, status] = params as string[];
      if (campaignParticipants.some((p) => p.campaign_id === campaignId && p.contact_id === contactId)) return { rows: [] };
      const row = { id: nextId("part"), campaign_id: campaignId, contact_id: contactId, status: status ?? "waiting", current_step_id: null, invite_claimed_at: null, invite_sent_at: null, invite_accepted_at: null, step_claimed_at: null, last_action_at: null, created_at: new Date().toISOString() };
      campaignParticipants.push(row);
      return { rows: [{ id: row.id }] };
    }

    // step-progression.ts's initializeParticipantStep, reached from
    // approveProspects for an active campaign — the same canonical
    // initializer campaigns.ts's addParticipants uses, not a second one.
    if (text.startsWith("select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and position>$2")) {
      const [campaignId, position] = params as [string, number];
      const row = campaignSteps.filter((s) => s.campaign_id === campaignId && (s.position as number) > Number(position)).sort((a, b) => (a.position as number) - (b.position as number))[0];
      return { rows: row ? [{ id: row.id, position: row.position, step_type: row.step_type, message_template: row.message_template ?? null }] : [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=$1,step_claimed_at=null")) {
      const [stepId, participantId] = params as string[];
      const row = campaignParticipants.find((p) => p.id === participantId);
      if (row) { row.current_step_id = stepId; row.step_claimed_at = null; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=coalesce($1,current_step_id),status='completed'")) {
      const [stepId, participantId] = params as [string | null, string];
      const row = campaignParticipants.find((p) => p.id === participantId);
      if (row) { row.current_step_id = stepId ?? row.current_step_id; row.status = "completed"; row.last_action_at = new Date().toISOString(); }
      return { rows: [] };
    }

    if (text.startsWith("update campaign_participants set status='active',started_at=coalesce")) {
      const [campaignId] = params as string[];
      for (const p of campaignParticipants) if (p.campaign_id === campaignId && p.status === "waiting") p.status = "active";
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

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, businessContexts, campaigns, campaignSteps, campaignParticipants, candidates, contacts, contactIdentities, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("./database", () => ({ get database() { return fakeDatabase; } }));

const searchLinkedInPeopleMock = vi.hoisted(() => vi.fn());
vi.mock("./providers/unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  searchLinkedInPeople: searchLinkedInPeopleMock,
}));

// No AI provider configured by default — most tests exercise the
// deterministic qualification path (§14: rules first, AI only where it adds
// value). Tests F/G explicitly configure a provider to prove the backend,
// not the model, has the final say on `fit`.
const generateStructuredMock = vi.hoisted(() => vi.fn());
const getAIProviderMock = vi.hoisted(() => vi.fn(() => null as { model: string; generateStructured: typeof generateStructuredMock } | null));
vi.mock("./ai", () => ({ getAIProvider: getAIProviderMock }));

// getCampaignStrategy lives in campaigns.ts (a much larger module with its
// own untested query surface) — mocked here so these tests isolate
// prospecting.ts's own contract with it, one call returning one strategy.
const getCampaignStrategyMock = vi.hoisted(() => vi.fn<(context: WorkspaceContext, campaignId: string) => Promise<CampaignStrategy | null>>(async () => null));
vi.mock("./campaigns", () => ({ getCampaignStrategy: getCampaignStrategyMock }));

const { approveProspects, listCandidates, searchProspects } = await import("./prospecting");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  searchLinkedInPeopleMock.mockClear();
  generateStructuredMock.mockReset();
  getAIProviderMock.mockReset();
  getAIProviderMock.mockReturnValue(null);
  getCampaignStrategyMock.mockReset();
  getCampaignStrategyMock.mockResolvedValue(null);
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

function makeStrategy(overrides: Partial<CampaignStrategy> = {}): CampaignStrategy {
  return {
    objective: "Trouver des décideurs marketing.",
    targetDescription: "Décideurs marketing dans des PME SaaS françaises.",
    targetRoles: ["Directrice marketing", "CMO"],
    companyTypes: ["PME SaaS"],
    industries: ["Logiciel"],
    geography: ["France"],
    qualificationCriteria: ["Décisionnaire budget marketing"],
    exclusionCriteria: ["Stagiaire"],
    reasoning: "Fondé sur le Business Context.",
    source: "ai_generated",
    manuallyEditedFields: [],
    generatedAt: new Date().toISOString(),
    aiModel: null,
    validatedAt: new Date().toISOString(), // validated by default — tests for the unvalidated case override this explicitly
    ...overrides,
  };
}

describe("searchProspects", () => {
  it("refuses to search when no Campaign Strategy exists at all", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(null);

    await expect(searchProspects(context, "camp-1")).rejects.toThrow(/stratégie/i);
    expect(searchLinkedInPeopleMock).not.toHaveBeenCalled();
  });

  it("B. refuses to search with an existing but unvalidated Campaign Strategy", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy({ validatedAt: null }));

    await expect(searchProspects(context, "camp-1")).rejects.toThrow(/valid/i);
    expect(searchLinkedInPeopleMock).not.toHaveBeenCalled();
  });

  it("C. allows search once the strategy has been explicitly validated", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy({ validatedAt: new Date().toISOString() }));
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [], cursor: null });

    await expect(searchProspects(context, "camp-1")).resolves.toEqual([]);
    expect(searchLinkedInPeopleMock).toHaveBeenCalled();
  });

  it("derives Unipile search keywords from the validated strategy, not raw free text", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy());
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [], cursor: null });

    await searchProspects(context, "camp-1");

    expect(searchLinkedInPeopleMock).toHaveBeenCalledWith(
      expect.anything(),
      "acct-1",
      { keywords: expect.stringMatching(/Directrice marketing|CMO/) },
    );
  });

  it("stores search results as review candidates without creating any Contact", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy());
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-1", name: "Awa Traoré", headline: "Directrice marketing", profile_url: "https://linkedin.com/in/awa", location: "Paris, France", current_positions: [{ company: "Acme", role: "Directrice marketing" }] }], cursor: null });

    const result = await searchProspects(context, "camp-1", "growth");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerId: "prov-1", name: "Awa Traoré", location: "Paris, France", role: "Directrice marketing", status: "suggested" });
    expect(fakeDatabase.contacts).toHaveLength(0);
    const listed = await listCandidates(context, "camp-1");
    expect(listed).toHaveLength(1);
  });

  it("a search that returns zero Unipile results never fabricates a candidate (G)", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy());
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [], cursor: null });

    const result = await searchProspects(context, "camp-1");

    expect(result).toEqual([]);
    expect(fakeDatabase.candidates).toHaveLength(0);
  });

  it("qualifies a candidate against real strategy/candidate data — role and location matches produce concrete reasons (H, I)", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    const strategy = makeStrategy();
    getCampaignStrategyMock.mockResolvedValueOnce(strategy);
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-1", name: "Awa Traoré", headline: "Directrice marketing chez Acme", profile_url: "https://linkedin.com/in/awa", location: "Paris, France", current_positions: [{ company: "Acme", role: "Directrice marketing" }] }], cursor: null });

    const [candidate] = await searchProspects(context, "camp-1");

    expect(candidate!.qualification).toBeDefined();
    expect(candidate!.qualification!.fit).toBe("strong");
    expect(candidate!.qualification!.reasons.some((reason) => /rôle/i.test(reason))).toBe(true);
    expect(candidate!.qualification!.reasons.some((reason) => /France/i.test(reason))).toBe(true);
    expect(candidate!.qualification!.model).toBeNull(); // deterministic path — no AI provider configured
    // Persisted, not just returned in-memory.
    const listed = await listCandidates(context, "camp-1");
    expect(listed[0]!.qualification?.fit).toBe("strong");
  });

  it("H. missing role/location data produces explicit uncertainties, never a fabricated positive match", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    const strategy = makeStrategy();
    getCampaignStrategyMock.mockResolvedValueOnce(strategy);
    // No location, no role/headline at all — LinkedIn simply didn't return it.
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-2", name: "Jean Dupont", profile_url: "https://linkedin.com/in/jean", current_positions: [] }], cursor: null });

    const [candidate] = await searchProspects(context, "camp-1");

    // insufficient_data now specifically means "not enough of THIS
    // candidate's own data to check what the strategy asks about" — not
    // "the strategy has no criteria" (it does, here).
    expect(candidate!.qualification!.fit).toBe("insufficient_data");
    expect(candidate!.qualification!.uncertainties.some((note) => /localisation/i.test(note))).toBe(true);
    expect(candidate!.qualification!.uncertainties.some((note) => /rôle/i.test(note))).toBe(true);
    expect(candidate!.qualification!.reasons).toEqual([]);
    expect(candidate!.qualification!.disqualified).toBe(false);
  });

  it("I. an explicit exclusion match disqualifies a candidate even with a strong positive role+geography signal", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    const strategy = makeStrategy({ exclusionCriteria: ["Stagiaire"] });
    getCampaignStrategyMock.mockResolvedValueOnce(strategy);
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-3", name: "Léo Martin", headline: "Stagiaire marketing — Directrice marketing junior", profile_url: "https://linkedin.com/in/leo", location: "Paris, France", current_positions: [{ company: "Acme", role: "Directrice marketing" }] }], cursor: null });

    const [candidate] = await searchProspects(context, "camp-1");

    expect(candidate!.qualification!.disqualified).toBe(true);
    expect(candidate!.qualification!.disqualificationReasons.some((reason) => /Stagiaire/i.test(reason))).toBe(true);
    // Never "strong"/"moderate" once disqualified, no matter how well role
    // and geography otherwise matched.
    expect(candidate!.qualification!.fit).toBe("weak");
  });

  it("F. the backend recomputes fit from an AI-proposed score of 20 as 'weak', regardless of the model's own framing", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy());
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-4", name: "Awa Traoré", headline: "Directrice marketing", profile_url: "https://linkedin.com/in/awa", location: "Paris, France", current_positions: [{ company: "Acme", role: "Directrice marketing" }] }], cursor: null });
    generateStructuredMock.mockResolvedValueOnce({ data: { qualifications: [{ candidateId: "cand-1", score: 20, reasons: ["Le profil semble correspondre."], uncertainties: [] }] }, model: "test-model", usage: { inputTokens: 1, outputTokens: 1 } });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });

    const [candidate] = await searchProspects(context, "camp-1");

    expect(candidate!.qualification!.score).toBe(20);
    expect(candidate!.qualification!.fit).toBe("weak");
    expect(candidate!.qualification!.model).toBe("test-model");
  });

  it("G. the backend recomputes fit from an AI-proposed score of 90 as 'strong'", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy());
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-5", name: "Awa Traoré", headline: "Directrice marketing", profile_url: "https://linkedin.com/in/awa", location: "Paris, France", current_positions: [{ company: "Acme", role: "Directrice marketing" }] }], cursor: null });
    generateStructuredMock.mockResolvedValueOnce({ data: { qualifications: [{ candidateId: "cand-1", score: 90, reasons: ["Correspondance forte."], uncertainties: [] }] }, model: "test-model", usage: { inputTokens: 1, outputTokens: 1 } });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });

    const [candidate] = await searchProspects(context, "camp-1");

    expect(candidate!.qualification!.score).toBe(90);
    expect(candidate!.qualification!.fit).toBe("strong");
  });

  it("F/G. an AI-detected exclusion match still forces 'weak', even with a high AI-proposed score", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy({ exclusionCriteria: ["Stagiaire"] }));
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [{ id: "prov-6", name: "Léo Martin", headline: "Stagiaire marketing", profile_url: "https://linkedin.com/in/leo", location: "Paris, France", current_positions: [{ company: "Acme", role: "Directrice marketing" }] }], cursor: null });
    generateStructuredMock.mockResolvedValueOnce({ data: { qualifications: [{ candidateId: "cand-1", score: 95, reasons: ["Très bon profil."], uncertainties: [] }] }, model: "test-model", usage: { inputTokens: 1, outputTokens: 1 } });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });

    const [candidate] = await searchProspects(context, "camp-1");

    expect(candidate!.qualification!.disqualified).toBe(true);
    expect(candidate!.qualification!.fit).toBe("weak");
  });

  it("workspace isolation: the strategy call is always scoped to this workspace's context", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1");
    searchLinkedInPeopleMock.mockResolvedValueOnce({ items: [], cursor: null });
    getCampaignStrategyMock.mockResolvedValueOnce(makeStrategy());

    await searchProspects(context, "camp-1");

    expect(getCampaignStrategyMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }), "camp-1");
  });

  it("J. workspace isolation for strategy validation: a validated strategy for one workspace never authorizes a search for another", async () => {
    const otherWorkspaceContext: WorkspaceContext = { authUserId: "auth-2", userId: "user-2", workspaceId: "ws-2", role: "owner" };
    seedConnectedAccount();
    fakeDatabase.connections.push({ workspace_id: "ws-2", provider: "unipile", channel_type: "linkedin", external_account_id: "acct-2", status: "connected" });
    seedCampaign("camp-1");
    // Same campaignId string reused for a different workspace's own
    // campaign — the mock simulates campaigns.ts's real workspace-scoped
    // lookup (`where workspace_id=$1 and id=$2`) returning nothing for a
    // workspace that doesn't own this campaign.
    getCampaignStrategyMock.mockImplementation(async (ctx: WorkspaceContext) => (ctx.workspaceId === workspaceId ? makeStrategy() : null));
    searchLinkedInPeopleMock.mockResolvedValue({ items: [], cursor: null });

    await expect(searchProspects(context, "camp-1")).resolves.toEqual([]);
    await expect(searchProspects(otherWorkspaceContext, "camp-1")).rejects.toThrow(/stratégie/i);
  });
});

describe("approveProspects", () => {
  it("A. on a draft campaign, a newly-approved participant stays 'waiting' until the campaign is activated", async () => {
    seedCampaign("camp-1", "draft");
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://linkedin.com/in/awa", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });

    const result = await approveProspects(context, "camp-1", ["cand-1"]);

    expect(result.approved).toBe(1);
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.contacts[0]).toMatchObject({ status: "lead" });
    expect(fakeDatabase.campaignParticipants).toHaveLength(1);
    // current_step_id stays NULL on purpose while the campaign is a draft.
    // Stamping it here (as this used to) silently disqualified the
    // participant from transitionCampaign's `status='waiting' and
    // current_step_id is null` activation guard, so "save as draft ->
    // approve prospects -> activate" left it stuck on 'waiting' forever —
    // a status the engine never claims, with no error recorded anywhere.
    // Activation is what places it on the first step, through the canonical
    // initializer.
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ campaign_id: "camp-1", status: "waiting", current_step_id: null });

    fakeDatabase.campaigns[0]!.status = "active";
    await fakeDatabase.query(`update campaign_participants set status='active',started_at=coalesce(started_at,now()),updated_at=now() where campaign_id=$1 and status='waiting'`, ["camp-1"]);

    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "active" });
  });

  it("B/M. on an already-active campaign, a newly-approved participant satisfies the executor's claim contract immediately", async () => {
    seedConnectedAccount();
    seedCampaign("camp-1", "active");
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://linkedin.com/in/awa", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });

    const result = await approveProspects(context, "camp-1", ["cand-1"]);

    expect(result.approved).toBe(1);
    // This is exactly what app/lib/campaign-execution/linkedin-executor.ts's
    // claim query requires (status='active', current_step_id=invite step,
    // invite_sent_at is null) — the actual claim/send behavior is covered
    // end-to-end in linkedin-executor.test.ts; this test only guards the
    // P0 regression this module's own status logic must never reintroduce.
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "active", current_step_id: "camp-1-invite", invite_sent_at: null });
  });

  it("N. on a draft campaign, a newly-approved participant stays 'waiting'", async () => {
    seedCampaign("camp-1", "draft");
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://linkedin.com/in/awa", name: "Awa Traoré", headline: null, company: null, status: "suggested", contact_id: null });

    const result = await approveProspects(context, "camp-1", ["cand-1"]);

    expect(result.approved).toBe(1);
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "waiting" });
  });

  it("C. approving the same candidate twice — including twice in one call — never duplicates the Contact or the participant", async () => {
    seedCampaign("camp-1", "active");
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://linkedin.com/in/awa", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });

    const first = await approveProspects(context, "camp-1", ["cand-1", "cand-1"]);
    const second = await approveProspects(context, "camp-1", ["cand-1"]);

    expect(first.approved).toBe(1);
    expect(second.approved).toBe(0);
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.campaignParticipants).toHaveLength(1);
  });

  it("K/L. resolves to the same Contact and participant a candidate was already dedup'd to, instead of duplicating either", async () => {
    seedCampaign("camp-1");
    fakeDatabase.contacts.push({ id: "contact-existing", workspace_id: workspaceId, display_name: "Awa Traoré", status: "qualified" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-existing", channel_type: "linkedin", identifier_normalized: "linkedin.com/in/awa" });
    fakeDatabase.candidates.push({ id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://www.linkedin.com/in/awa/", name: "Awa Traoré", headline: "Directrice marketing", company: "Acme", status: "suggested", contact_id: null });

    await approveProspects(context, "camp-1", ["cand-1"]);

    expect(fakeDatabase.contacts).toHaveLength(1);
    // Already-qualified contact must not be reset to 'lead' just because a
    // prospecting search happened to also find them.
    expect(fakeDatabase.contacts[0]).toMatchObject({ status: "qualified" });
    expect(fakeDatabase.campaignParticipants).toHaveLength(1);
  });

  // Phase 2B §K (distinct from the K/L dedup test above, which is Phase 2's
  // own numbering) — Talvia keeps the founder's control: it flags a poor
  // fit, it never blocks approving one.
  it("K. a weak/disqualified candidate can still be approved manually — qualification never blocks approval", async () => {
    seedCampaign("camp-1", "active");
    fakeDatabase.candidates.push({
      id: "cand-1", workspace_id: workspaceId, campaign_id: "camp-1", provider_id: "prov-1", profile_url: "https://linkedin.com/in/leo", name: "Léo Martin", headline: "Stagiaire marketing", company: "Acme", status: "suggested", contact_id: null,
      qualification: { score: 20, fit: "weak", reasons: [], uncertainties: [], disqualified: true, disqualificationReasons: ['Correspond à un critère d\'exclusion : "Stagiaire".'], model: null, qualifiedAt: new Date().toISOString() },
    });

    const result = await approveProspects(context, "camp-1", ["cand-1"]);

    expect(result.approved).toBe(1);
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.campaignParticipants).toHaveLength(1);
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "active" });
  });
});

// Batch-limit, failure-retry, re-claim idempotence, and blocked-campaign
// behavior for the LinkedIn executor itself live in
// app/lib/campaign-execution/linkedin-executor.test.ts. Strategy generation
// and human-edit preservation are pure functions, tested directly in
// app/lib/campaign-strategy.test.ts.

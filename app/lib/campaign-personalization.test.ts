import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "./workspace-context";
import type { CampaignStrategy } from "./campaign-strategy";
import type { BusinessContextRecord } from "./business-context/business-context-service";

function createFakeDatabase() {
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const candidates: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };

    if (text.startsWith("select p.contact_id from campaign_participants p join campaigns c")) {
      const [workspaceId, campaignId, participantId] = params as string[];
      const campaign = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      const row = campaignParticipants.find((p) => p.id === participantId && p.campaign_id === campaignId);
      if (!campaign || !row) return { rows: [] };
      return { rows: [{ contact_id: row.contact_id }] };
    }
    if (text.startsWith("select p.personalization from campaign_participants p join campaigns c")) {
      const [workspaceId, campaignId, participantId] = params as string[];
      const campaign = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      const row = campaignParticipants.find((p) => p.id === participantId && p.campaign_id === campaignId);
      if (!campaign || !row) return { rows: [] };
      return { rows: [{ personalization: row.personalization ?? null }] };
    }
    if (text.startsWith("update campaign_participants p set personalization=$1 from campaigns c")) {
      const [personalization, workspaceId, campaignId, participantId] = params as string[];
      const campaign = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      const row = campaignParticipants.find((p) => p.id === participantId && p.campaign_id === campaignId);
      if (!campaign || !row) return { rowCount: 0, rows: [] };
      row.personalization = JSON.parse(personalization);
      return { rowCount: 1, rows: [] };
    }
    if (text.startsWith("select name,headline,role,company,location,profile_url,qualification from campaign_prospect_candidates")) {
      const [workspaceId, campaignId, contactId] = params as string[];
      const row = candidates.find((c) => c.workspace_id === workspaceId && c.campaign_id === campaignId && c.contact_id === contactId && c.status === "approved");
      return { rows: row ? [{ name: row.name, headline: row.headline ?? null, role: row.role ?? null, company: row.company ?? null, location: row.location ?? null, profile_url: row.profile_url ?? null, qualification: row.qualification ?? null }] : [] };
    }
    if (text.startsWith("select id,message_template from campaign_steps where campaign_id=$1 and step_type='message' order by position")) {
      const [campaignId] = params as string[];
      const rows = campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").sort((a, b) => (a.position as number) - (b.position as number));
      return { rows: rows.map((row) => ({ id: row.id, message_template: row.message_template ?? null })) };
    }
    if (text.startsWith("select id,position from campaign_steps where campaign_id=$1 and step_type='message'")) {
      const [campaignId] = params as string[];
      return { rows: campaignSteps.filter((s) => s.campaign_id === campaignId && s.step_type === "message").map((s) => ({ id: s.id, position: s.position })) };
    }
    if (text.startsWith("select p.id from campaign_participants p join campaigns c")) {
      const [workspaceId, campaignId] = params as string[];
      return { rows: campaignParticipants.filter((p) => p.campaign_id === campaignId && campaigns.some((c) => c.id === campaignId && c.workspace_id === workspaceId) && (!p.personalization || (p.personalization as { invitation: { status: string } }).invitation.status === "not_generated")).map((p) => ({ id: p.id })) };
    }
    if (text.startsWith("select ct.first_name,ct.display_name,co.name company from contacts ct")) {
      const [workspaceId, contactId] = params as string[];
      const row = contacts.find((c) => c.workspace_id === workspaceId && c.id === contactId);
      return { rows: row ? [{ first_name: row.first_name, display_name: row.display_name, company: row.company ?? null }] : [] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), campaigns, campaignParticipants, campaignSteps, candidates, contacts };
}

let fakeDatabase = createFakeDatabase();
vi.mock("./database", () => ({ get database() { return fakeDatabase; } }));

const generateStructuredMock = vi.hoisted(() => vi.fn());
const getAIProviderMock = vi.hoisted(() => vi.fn(() => null as { model: string; generateStructured: typeof generateStructuredMock } | null));
vi.mock("./ai", () => ({ getAIProvider: getAIProviderMock }));

const getCampaignStrategyMock = vi.hoisted(() => vi.fn(async () => null as CampaignStrategy | null));
vi.mock("./campaigns", () => ({ getCampaignStrategy: getCampaignStrategyMock }));

const getActiveBusinessContextMock = vi.hoisted(() => vi.fn(async () => null as BusinessContextRecord | null));
vi.mock("./business-context/business-context-service", () => ({ getActiveBusinessContext: getActiveBusinessContextMock }));

const {
  buildPersonalizationEvidence,
  getParticipantPersonalization,
  generateParticipantPersonalization,
  generateWhatsAppParticipantPersonalization,
  generatePersonalizationForCampaign,
  editParticipantInvitation,
  approveParticipantInvitation,
  editParticipantMessage,
  approveParticipantMessage,
} = await import("./campaign-personalization");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  generateStructuredMock.mockReset();
  getAIProviderMock.mockReset();
  getAIProviderMock.mockReturnValue(null);
  getCampaignStrategyMock.mockReset();
  getCampaignStrategyMock.mockResolvedValue(null);
  getActiveBusinessContextMock.mockReset();
  getActiveBusinessContextMock.mockResolvedValue(null);
});

const workspaceId = "ws-1";
const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId, role: "owner" };

function seedCampaign(campaignId: string, forWorkspaceId = workspaceId) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: forWorkspaceId });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-message`, campaign_id: campaignId, position: 1, step_type: "message", message_template: null });
}
// message(1) -> wait(2) -> follow-up(3) — a follow-up is generated as a
// second, ordinary 'message' step (docs spec §9); the wait step itself is
// irrelevant to generation and only included for realism.
function seedCampaignWithFollowUp(campaignId: string, forWorkspaceId = workspaceId) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: forWorkspaceId });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-message`, campaign_id: campaignId, position: 1, step_type: "message", message_template: null });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 2, step_type: "wait", delay_value: 3, delay_unit: "days" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-followup`, campaign_id: campaignId, position: 3, step_type: "message", message_template: null });
}
function seedParticipant(campaignId: string, participantId: string, contactId: string, personalization: unknown = null) {
  fakeDatabase.campaignParticipants.push({ id: participantId, campaign_id: campaignId, contact_id: contactId, personalization });
}
function seedCandidate(campaignId: string, contactId: string, overrides: Partial<Record<string, unknown>> = {}) {
  fakeDatabase.candidates.push({ workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, name: "Awa Traoré", status: "approved", ...overrides });
}
function seedContact(contactId: string, overrides: Partial<Record<string, unknown>> = {}) {
  fakeDatabase.contacts.push({ workspace_id: workspaceId, id: contactId, first_name: "Jean", display_name: "Jean Dupont", company: null, ...overrides });
}
// message(0) -> wait(1) -> message(2) — WhatsApp's own canonical shape
// (no invite step, matching CampaignsClient.tsx's non-prospecting wizard).
function seedWhatsAppCampaign(campaignId: string, forWorkspaceId = workspaceId) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: forWorkspaceId });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 0, step_type: "message", message_template: "Bonjour {first_name}, ravi d'échanger avec {company} !" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 1, step_type: "wait", delay_value: 3, delay_unit: "days" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg2`, campaign_id: campaignId, position: 2, step_type: "message", message_template: null });
}

const sampleStrategy = {
  targetRoles: ["Fondateur"], companyTypes: ["agence"], industries: ["marketing"], geography: ["France"],
  qualificationCriteria: [], exclusionCriteria: [], validatedAt: new Date().toISOString(),
} as unknown as CampaignStrategy;

describe("buildPersonalizationEvidence — epistemic separation (A, B, C)", () => {
  it("A. known role and company become exactly the corresponding real observed facts", () => {
    const evidence = buildPersonalizationEvidence({ name: "Awa Traoré", headline: "Fondatrice", role: "Fondatrice", company: "Acme", location: "Paris" }, null);

    expect(evidence.observedFacts).toContainEqual({ type: "role", value: "Fondatrice", source: "linkedin_search" });
    expect(evidence.observedFacts).toContainEqual({ type: "company", value: "Acme", source: "linkedin_search" });
    expect(evidence.observedFacts.every((fact) => ["name", "headline", "role", "company", "location"].includes(fact.type))).toBe(true);
  });

  it("B. an unknown company never appears as an observed fact — only as an uncertainty", () => {
    const evidence = buildPersonalizationEvidence({ name: "Bob Martin" }, null);

    expect(evidence.observedFacts.some((fact) => fact.type === "company")).toBe(false);
    expect(evidence.uncertainties.some((note) => /entreprise/i.test(note))).toBe(true);
  });

  it("C. qualification reasons and strategy company types never appear inside observedFacts", () => {
    const evidence = buildPersonalizationEvidence(
      { name: "Awa Traoré", company: "Acme", qualification: { score: 80, fit: "strong", reasons: ["Correspond au rôle ciblé"], uncertainties: [], disqualified: false, disqualificationReasons: [], model: null, qualifiedAt: new Date().toISOString() } },
      sampleStrategy,
    );

    // Neither qualification reasoning nor the campaign's general target
    // description is a fact about THIS person — they live in their own
    // separately-labeled context objects instead.
    expect(evidence.observedFacts.some((fact) => fact.type === "qualification_reason")).toBe(false);
    expect(evidence.observedFacts.some((fact) => fact.type === "target_company_type")).toBe(false);
    expect(evidence.observedFacts.some((fact) => fact.value.includes("agence"))).toBe(false);
    expect(evidence.qualificationContext?.reasons).toContain("Correspond au rôle ciblé");
    expect(evidence.strategyContext?.companyTypes).toContain("agence");
  });
});

describe("generateParticipantPersonalization — no AI provider (O)", () => {
  it("O. produces a deterministic fallback using only real known fields, not a sophisticated invented one", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { headline: "Fondatrice", role: "Fondatrice", company: "Acme" });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.aiModel).toBeNull();
    expect(result.personalization.invitation.generatedText).toContain("Awa");
    expect(result.personalization.invitation.status).toBe("generated");
    expect(result.personalization.invitation.approvedText).toBeNull();
  });

  it("O2. the deterministic fallback never asserts a strategy company type as this prospect's own attribute", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { company: "Acme" });
    getCampaignStrategyMock.mockResolvedValue(sampleStrategy);

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Allowed: describing Talvia's own clientele ("je travaille avec des
    // agences"). Forbidden: "Acme est une agence" — asserting the strategy
    // label as a proven fact about this specific company.
    expect(result.personalization.messages[0]?.generatedText).not.toMatch(/Acme est une agence/i);
  });

  it("D. an uncertainty from qualification is never converted into a stated fact", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", {
      headline: null, role: null, company: null,
      qualification: { score: 50, fit: "insufficient_data", reasons: [], uncertainties: ["Rôle/fonction non connu — ne pas affirmer de fonction précise."], disqualified: false, disqualificationReasons: [], model: null, qualifiedAt: new Date().toISOString() },
    });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.evidence.uncertainties).toContain("Rôle/fonction non connu — ne pas affirmer de fonction précise.");
    expect(result.personalization.invitation.generatedText).not.toMatch(/fondatrice|directeur|directrice|CEO/i);
  });
});

describe("generateParticipantPersonalization — structured grounding via usedFactTypes (E)", () => {
  it("E1. a text citing a fact type absent from observedFacts is rejected for the safe fallback", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { headline: "Fondatrice", company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: [], conversationGoal: "z", tone: "amical" },
        invitation: { text: "J'ai vu votre récent post sur LinkedIn, très inspirant !", usedFactTypes: ["recent_post"] },
        message: { text: "Message classique.", usedFactTypes: [] },
      },
      model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.invitation.generatedText).not.toMatch(/post/i);
    // Only the ungrounded artifact falls back — aiModel is still recorded
    // since the call succeeded and at least the response shape was used.
  });

  it("E2. an assertive text citing zero facts (and not phrased as a question) is rejected even without a matching regex", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { headline: "Fondatrice", company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: [], conversationGoal: "z", tone: "amical" },
        invitation: { text: "Votre équipe traverse actuellement une phase de transformation majeure.", usedFactTypes: [] },
        message: { text: "Bonjour, merci d'avoir accepté !", usedFactTypes: [] },
      },
      model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.invitation.generatedText).not.toMatch(/transformation majeure/i);
  });

  it("E3. an open question citing zero facts is accepted — a question invites confirmation, it doesn't assert", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { headline: "Fondatrice", company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: [], conversationGoal: "z", tone: "amical" },
        invitation: { text: "Bonjour Awa, ravie de découvrir votre profil chez Acme !", usedFactTypes: ["company"] },
        message: { text: "Est-ce que l'acquisition est un sujet que vous travaillez actuellement ?", usedFactTypes: [] },
      },
      model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.messages[0]?.generatedText).toBe("Est-ce que l'acquisition est un sujet que vous travaillez actuellement ?");
    expect(result.personalization.aiModel).toBe("test-model");
  });

  it("keeps a well-supported AI proposal that cites real observed fact types", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { headline: "Fondatrice", company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: ["role", "company"], conversationGoal: "z", tone: "amical" },
        invitation: { text: "Bonjour Awa, ravie de découvrir votre profil chez Acme !", usedFactTypes: ["company"] },
        message: { text: "Merci d'avoir accepté, ravi d'échanger sur Acme.", usedFactTypes: ["company"] },
      },
      model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.aiModel).toBe("test-model");
    expect(result.personalization.invitation.generatedText).toContain("Acme");
  });
});

describe("F/G/H/I — persistence, human edit, approval, regeneration safety", () => {
  it("F. generated personalization persists per participant", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedParticipant("camp-1", "part-2", "contact-2");
    seedCandidate("camp-1", "contact-1", { name: "Awa Traoré" });
    seedCandidate("camp-1", "contact-2", { name: "Bob Martin" });

    await generateParticipantPersonalization(context, "camp-1", "part-1");
    await generateParticipantPersonalization(context, "camp-1", "part-2");

    const p1 = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { invitation: { generatedText: string } } };
    const p2 = fakeDatabase.campaignParticipants.find((p) => p.id === "part-2")! as { personalization: { invitation: { generatedText: string } } };
    expect(p1.personalization.invitation.generatedText).toContain("Awa");
    expect(p2.personalization.invitation.generatedText).toContain("Bob");
    expect(p1.personalization.invitation.generatedText).not.toBe(p2.personalization.invitation.generatedText);
  });

  it("G. a human edit to the invitation persists completely unfiltered (no grounding check applied)", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    await generateParticipantPersonalization(context, "camp-1", "part-1");

    // Deliberately includes the exact phrasing the grounding/regex checks
    // would reject if it came from the AI — a human is allowed to write it.
    const humanText = "Bonjour Awa, j'ai vu votre récent post sur LinkedIn, votre CA a explosé !";
    const edited = await editParticipantInvitation(context, "camp-1", "part-1", humanText);

    expect(edited?.invitation.status).toBe("edited");
    expect(edited?.invitation.editedText).toBe(humanText);
  });

  it("H. approving an edited invitation makes the edited text the approved text", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    await generateParticipantPersonalization(context, "camp-1", "part-1");
    await editParticipantInvitation(context, "camp-1", "part-1", "Texte édité par l'utilisateur.");

    const approved = await approveParticipantInvitation(context, "camp-1", "part-1");

    expect(approved?.invitation.status).toBe("approved");
    expect(approved?.invitation.approvedText).toBe("Texte édité par l'utilisateur.");
    expect(approved?.invitation.approvedAt).not.toBeNull();
  });

  it("I. regenerating after approval never silently overwrites the approved invitation", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    await generateParticipantPersonalization(context, "camp-1", "part-1");
    await approveParticipantInvitation(context, "camp-1", "part-1");
    const approvedBefore = (fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { invitation: { approvedText: string } } }).personalization.invitation.approvedText;

    await generateParticipantPersonalization(context, "camp-1", "part-1");

    const after = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { invitation: { status: string; approvedText: string } } };
    expect(after.personalization.invitation.status).toBe("approved");
    expect(after.personalization.invitation.approvedText).toBe(approvedBefore);
  });

  it("I. the same safety applies to the per-step message artifact", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    await generateParticipantPersonalization(context, "camp-1", "part-1");
    await approveParticipantMessage(context, "camp-1", "part-1", "camp-1-message");
    const before = (fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { messages: Array<{ approvedText: string }> } }).personalization.messages[0]!.approvedText;

    await generateParticipantPersonalization(context, "camp-1", "part-1");

    const after = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { messages: Array<{ status: string; approvedText: string }> } };
    expect(after.personalization.messages[0]!.status).toBe("approved");
    expect(after.personalization.messages[0]!.approvedText).toBe(before);
  });

  it("H. editing then approving a message persists the approved text keyed by step", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    await generateParticipantPersonalization(context, "camp-1", "part-1");
    await editParticipantMessage(context, "camp-1", "part-1", "camp-1-message", "Message édité à la main.");

    const approved = await approveParticipantMessage(context, "camp-1", "part-1", "camp-1-message");

    expect(approved?.messages[0]).toMatchObject({ stepId: "camp-1-message", status: "approved", approvedText: "Message édité à la main." });
  });
});

describe("generatePersonalizationForCampaign — batching (N workspace isolation)", () => {
  it("N. only targets participants belonging to the requested workspace's campaign", async () => {
    seedCampaign("camp-1", workspaceId);
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    const otherWorkspaceContext: WorkspaceContext = { authUserId: "auth-2", userId: "user-2", workspaceId: "ws-2", role: "owner" };

    const resultForOwner = await generatePersonalizationForCampaign(context, "camp-1");
    const resultForOther = await generatePersonalizationForCampaign(otherWorkspaceContext, "camp-1");

    expect(resultForOwner.generated).toBe(1);
    expect(resultForOther.generated).toBe(0);
    expect(resultForOther.failed).toBe(0);
  });
});

describe("Phase 4 — follow-up generation (L continuity/regeneration safety, M stepId isolation)", () => {
  it("L1. a follow-up references the previous message for continuity, not a fresh introduction", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock
      .mockResolvedValueOnce({
        data: {
          outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: ["company"], conversationGoal: "z", tone: "amical" },
          invitation: { text: "Bonjour Awa, ravie de découvrir votre profil chez Acme !", usedFactTypes: ["company"] },
          message: { text: "Merci d'avoir accepté, ravi d'échanger sur Acme.", usedFactTypes: ["company"] },
        },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        data: { text: "Je me permets de revenir vers vous suite à mon message précédent, est-ce toujours d'actualité ?", factualClaims: [], conversationalReferences: ["revenir vers vous suite au message précédent"] },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.messages).toHaveLength(2);
    // Proves the AI-generated (grounded, accepted) text was kept — not the
    // deterministic fallback, which happens to use similar wording and would
    // otherwise make this assertion pass even on a wrongly-rejected proposal.
    expect(result.personalization.messages[1]!.generatedText).toBe("Je me permets de revenir vers vous suite à mon message précédent, est-ce toujours d'actualité ?");
    // The follow-up prompt itself carried the first message's text forward.
    const followUpPrompt = generateStructuredMock.mock.calls[1]![0].prompt as string;
    expect(followUpPrompt).toContain("Merci d'avoir accepté, ravi d'échanger sur Acme.");
  });

  it("L2. regenerating never overwrites an already-approved follow-up, but still chains continuity from it", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");
    await generateParticipantPersonalization(context, "camp-1", "part-1");
    await approveParticipantMessage(context, "camp-1", "part-1", "camp-1-message");
    await approveParticipantMessage(context, "camp-1", "part-1", "camp-1-followup");
    type StoredMessage = { stepId: string; approvedText: string };
    const beforeRow = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { messages: StoredMessage[] } };
    const approvedBefore = beforeRow.personalization.messages.find((m) => m.stepId === "camp-1-followup")!;

    await generateParticipantPersonalization(context, "camp-1", "part-1");

    const after = fakeDatabase.campaignParticipants.find((p) => p.id === "part-1")! as { personalization: { messages: Array<{ stepId: string; status: string; approvedText: string }> } };
    const followUp = after.personalization.messages.find((m) => m.stepId === "camp-1-followup")!;
    expect(followUp.status).toBe("approved");
    expect(followUp.approvedText).toBe(approvedBefore.approvedText);
  });

  it("M. the follow-up's generated text is never identical to the first message's — distinct stepIds, distinct content", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1");

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const [first, followUp] = result.personalization.messages;
    expect(first!.stepId).toBe("camp-1-message");
    expect(followUp!.stepId).toBe("camp-1-followup");
    expect(followUp!.generatedText).not.toBe(first!.generatedText);
  });

  it("O. a previous-message question can never license an unsupported factual claim, even citing a real fact type", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { role: "Founder", company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock
      .mockResolvedValueOnce({
        data: {
          outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: ["company"], conversationGoal: "z", tone: "amical" },
          invitation: { text: "Bonjour, ravi de découvrir votre profil chez Acme !", usedFactTypes: ["company"] },
          message: { text: "Est-ce que l'acquisition est un sujet chez vous actuellement ?", usedFactTypes: [] },
        },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        // Adversarial: cites a real fact type ("company") to smuggle in an
        // assertion the fact does not actually support — exactly the case
        // the Phase 4 audit demonstrated slipping through.
        data: {
          text: "Comme l'acquisition est un enjeu important pour Acme, je voulais revenir vers vous.",
          factualClaims: [{ claim: "l'acquisition est un enjeu important pour Acme", supportedByFactTypes: ["company"] }],
          conversationalReferences: [],
        },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.messages[1]!.generatedText).not.toMatch(/enjeu important/i);
  });

  it("P. an open question referencing the previous topic is accepted, with zero factual claims", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock
      .mockResolvedValueOnce({
        data: {
          outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: ["company"], conversationGoal: "z", tone: "amical" },
          invitation: { text: "Bonjour, ravi de découvrir votre profil chez Acme !", usedFactTypes: ["company"] },
          message: { text: "Est-ce que l'acquisition est un sujet chez vous actuellement ?", usedFactTypes: [] },
        },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        data: { text: "Est-ce que le sujet vous intéresse toujours ?", factualClaims: [], conversationalReferences: ["relance sur le sujet précédent"] },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.messages[1]!.generatedText).toBe("Est-ce que le sujet vous intéresse toujours ?");
    expect(result.personalization.aiModel).toBe("test-model");
  });

  it("Q. a safe conversational reference with no question mark is accepted, not rejected as an unsupported assertion", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { company: "Acme" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock
      .mockResolvedValueOnce({
        data: {
          outreachAngle: { whyContactThisPerson: "x", relevantOffer: "y", evidenceUsed: ["company"], conversationGoal: "z", tone: "amical" },
          invitation: { text: "Bonjour, ravi de découvrir votre profil chez Acme !", usedFactTypes: ["company"] },
          message: { text: "Est-ce que l'acquisition est un sujet chez vous actuellement ?", usedFactTypes: [] },
        },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        data: { text: "Je me permets de revenir vers vous au cas où mon précédent message se serait perdu.", factualClaims: [], conversationalReferences: ["bump sur message précédent"] },
        model: "test-model", usage: { inputTokens: 1, outputTokens: 1 },
      });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.messages[1]!.generatedText).toBe("Je me permets de revenir vers vous au cas où mon précédent message se serait perdu.");
  });

  it("R. the deterministic follow-up fallback never uses qualification, strategy, or previousText content", async () => {
    seedCampaignWithFollowUp("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", {
      company: "Acme",
      qualification: { score: 90, fit: "strong", reasons: ["Correspond parfaitement au rôle ciblé"], uncertainties: [], disqualified: false, disqualificationReasons: [], model: null, qualifiedAt: new Date().toISOString() },
    });
    getCampaignStrategyMock.mockResolvedValue(sampleStrategy);
    // No AI provider — forces the deterministic fallback for both rounds.

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const followUpText = result.personalization.messages[1]!.generatedText!;
    expect(followUpText).not.toMatch(/agence|correspond parfaitement/i);
    expect(followUpText).toContain("revenir vers vous");
  });
});

describe("backward compatibility — old-shape stored evidence (J, K)", () => {
  it("J. an old-shape evidence.facts record is never trusted as grounded observedFacts under the new model", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1", {
      evidence: { facts: [{ type: "qualification_reason", value: "Correspond au rôle ciblé", source: "qualification" }], uncertainties: [] },
      outreachAngle: null,
      invitation: { status: "generated", generatedText: "Ancien texte", editedText: null, approvedText: null, approvedAt: null },
      messages: [],
      generatedAt: new Date().toISOString(),
      aiModel: null,
    });

    const personalization = await getParticipantPersonalization(context, "camp-1", "part-1");

    expect(personalization?.evidence.observedFacts).toEqual([]);
    expect(personalization?.evidence.qualificationContext).toBeNull();
  });

  it("K. an already-approved invitation from an old-shape record remains safely readable and sendable", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1", {
      evidence: { facts: [], uncertainties: [] },
      outreachAngle: null,
      invitation: { status: "approved", generatedText: "Ancien texte", editedText: null, approvedText: "Texte déjà approuvé et prêt à être envoyé.", approvedAt: new Date().toISOString() },
      messages: [],
      generatedAt: new Date().toISOString(),
      aiModel: null,
    });

    const personalization = await getParticipantPersonalization(context, "camp-1", "part-1");

    expect(personalization?.invitation.status).toBe("approved");
    expect(personalization?.invitation.approvedText).toBe("Texte déjà approuvé et prêt à être envoyé.");
  });
});

describe("generateWhatsAppParticipantPersonalization — Contact-sourced, no campaign_prospect_candidates", () => {
  it("substitutes the Contact's real first_name/company into the step's own template", async () => {
    seedWhatsAppCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré", company: "Nova Studio" });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const first = result.personalization.messages.find((m) => m.stepId === "camp-1-msg1")!;
    expect(first.generatedText).toBe("Bonjour Awa, ravi d'échanger avec Nova Studio !");
    expect(result.personalization.aiModel).toBeNull(); // no AI call, ever
  });

  it("never touches campaign_prospect_candidates — no candidate seeded, generation still succeeds", async () => {
    seedWhatsAppCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    // Deliberately no seedCandidate() call — proves this path never queries
    // campaign_prospect_candidates at all (the fake DB would throw
    // "unhandled query" if it tried).

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
  });

  it("falls back to a safe, generic greeting when the step has no template and company is unknown — never invents a company", async () => {
    seedWhatsAppCampaign("camp-1");
    fakeDatabase.campaignSteps.find((s) => s.id === "camp-1-msg1")!.message_template = null;
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré", company: null });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const first = result.personalization.messages.find((m) => m.stepId === "camp-1-msg1")!;
    expect(first.generatedText).toBe("Bonjour Awa, je me permets de revenir vers vous.");
    expect(first.generatedText).not.toMatch(/nova|entreprise inconnue/i);
  });

  it("populates observedFacts from the real Contact fields, never from qualification/strategy", async () => {
    seedWhatsAppCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré", company: "Nova Studio" });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.evidence.observedFacts).toContainEqual({ type: "name", value: "Awa Traoré", source: "contact" });
    expect(result.personalization.evidence.observedFacts).toContainEqual({ type: "company", value: "Nova Studio", source: "contact" });
    expect(result.personalization.evidence.qualificationContext).toBeNull();
    expect(result.personalization.evidence.strategyContext).toBeNull();
  });

  it("never overwrites an already-approved message, but still fills a not-yet-approved second step", async () => {
    seedWhatsAppCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");
    await approveParticipantMessage(context, "camp-1", "part-1", "camp-1-msg1");
    const approvedBefore = (await getParticipantPersonalization(context, "camp-1", "part-1"))!.messages.find((m) => m.stepId === "camp-1-msg1")!.approvedText;

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const first = result.personalization.messages.find((m) => m.stepId === "camp-1-msg1")!;
    const second = result.personalization.messages.find((m) => m.stepId === "camp-1-msg2")!;
    expect(first.status).toBe("approved");
    expect(first.approvedText).toBe(approvedBefore);
    expect(second.status).toBe("generated");
    expect(second.generatedText).not.toBeNull();
  });

  it("requires human approval — generation alone never produces an approvedText", async () => {
    seedWhatsAppCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    for (const message of result.personalization.messages) expect(message.approvedText).toBeNull();
  });
});

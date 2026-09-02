import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "./workspace-context";
import type { CampaignStrategy } from "./campaign-strategy";
import type { BusinessContextRecord } from "./business-context/business-context-service";
import type { MessageArtifact } from "./campaign-personalization";

function createFakeDatabase() {
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const candidates: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  // C2 — backs buildWhatsAppConversationContext (C1, reused verbatim) via
  // conversation-resolution.ts's canonical query and conversation-context.ts's
  // bounded messages fetch. Same shape/semantics as
  // campaign-execution/conversation-context.test.ts's own fake DB.
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];

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
    if (text.startsWith("select objective from campaigns where workspace_id=$1 and id=$2")) {
      const [workspaceId, campaignId] = params as string[];
      const row = campaigns.find((c) => c.id === campaignId && c.workspace_id === workspaceId);
      return { rows: row ? [{ objective: row.objective ?? "follow_up" }] : [] };
    }
    // conversation-resolution.ts's canonical query — same tie-break as C1/Phase B.
    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2 and channel_type=$3")) {
      const [workspaceId, contactId, channelType] = params as [string, string, string];
      const rows = conversations
        .filter((c) => c.workspace_id === workspaceId && c.contact_id === contactId && c.channel_type === channelType)
        .slice()
        .sort((a, b) => {
          const aKey = (a.last_message_at as string | null) ?? (a.created_at as string);
          const bKey = (b.last_message_at as string | null) ?? (b.created_at as string);
          if (aKey !== bKey) return aKey < bKey ? 1 : -1;
          if (a.created_at !== b.created_at) return (a.created_at as string) < (b.created_at as string) ? 1 : -1;
          return (a.id as string) < (b.id as string) ? 1 : -1;
        });
      return { rows: rows.length ? [{ id: rows[0]!.id }] : [] };
    }
    // conversation-context.ts's bounded messages fetch — newest-first with a
    // limit, draft-excluded, deterministic tie-break on id.
    if (text.startsWith("select direction, body, effective_time from messages where workspace_id=$1 and conversation_id=$2 and status<>'draft'")) {
      const [workspaceId, conversationId, limit] = params as [string, string, number];
      const rows = messages
        .filter((m) => m.workspace_id === workspaceId && m.conversation_id === conversationId && m.status !== "draft")
        .slice()
        .sort((a, b) => {
          if (a.effective_time !== b.effective_time) return (a.effective_time as string) < (b.effective_time as string) ? 1 : -1;
          return (a.id as string) < (b.id as string) ? 1 : -1;
        })
        .slice(0, limit)
        .map((m) => ({ direction: m.direction, body: m.body, effective_time: m.effective_time }));
      return { rows };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), campaigns, campaignParticipants, campaignSteps, candidates, contacts, conversations, messages };
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
function seedWhatsAppCampaign(campaignId: string, opts: { forWorkspaceId?: string; objective?: "follow_up" | "reactivation" } = {}) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: opts.forWorkspaceId ?? workspaceId, objective: opts.objective ?? "follow_up" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 0, step_type: "message", message_template: "Bonjour {first_name}, ravi d'échanger avec {company} !" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-wait`, campaign_id: campaignId, position: 1, step_type: "wait", delay_value: 3, delay_unit: "days" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg2`, campaign_id: campaignId, position: 2, step_type: "message", message_template: null });
}
// C2 evidence fixtures — mirrors campaign-execution/conversation-context.test.ts's
// own seedConversation/seedMessage exactly (same fake-DB shape/semantics).
function seedConversation(id: string, contactId: string, opts: { workspaceId?: string; lastMessageAt?: string | null; createdAt?: string } = {}) {
  fakeDatabase.conversations.push({
    id, workspace_id: opts.workspaceId ?? workspaceId, contact_id: contactId, channel_type: "whatsapp",
    last_message_at: opts.lastMessageAt ?? null, created_at: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
  });
}
function seedMessage(id: string, conversationId: string, opts: { workspaceId?: string; direction?: "inbound" | "outbound"; body?: string; status?: string; effectiveTime?: string } = {}) {
  fakeDatabase.messages.push({
    id, workspace_id: opts.workspaceId ?? workspaceId, conversation_id: conversationId,
    direction: opts.direction ?? "inbound", body: opts.body ?? "Bonjour", status: opts.status ?? "received",
    effective_time: opts.effectiveTime ?? "2026-01-01T00:00:00.000Z",
  });
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

// C2 — grounded WhatsApp personalization. Single-step campaigns throughout
// this block so each test's single generateStructuredMock queue entry maps
// unambiguously to the one message step under test — seedWhatsAppCampaign's
// second "msg2" step (used above) would otherwise trigger a second,
// separately-mocked AI call.
function seedWhatsAppCampaignSingleStep(campaignId: string, opts: { forWorkspaceId?: string; objective?: "follow_up" | "reactivation" } = {}) {
  fakeDatabase.campaigns.push({ id: campaignId, workspace_id: opts.forWorkspaceId ?? workspaceId, objective: opts.objective ?? "follow_up" });
  fakeDatabase.campaignSteps.push({ id: `${campaignId}-msg1`, campaign_id: campaignId, position: 0, step_type: "message", message_template: null });
}
// C2 correction — the model no longer returns free `text` + independent
// `claims[]`; it returns an ordered `segments[]` (kind "generic" | "factual"
// + supportedByEvidenceIds), and the server reconstructs the sent text by
// concatenating validated segments. See campaign-personalization.ts's
// isAcceptableWhatsAppGeneration for why: a free-text field left a span of
// the message that neither claim validation nor the old regex backstop
// necessarily covered.
type MockSegment = { kind: "generic" | "factual"; text: string; supportedByEvidenceIds?: string[] };
function mockSegmentedWhatsAppGeneration(segments: MockSegment[], uncertain = false) {
  getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
  generateStructuredMock.mockResolvedValueOnce({
    data: { segments: segments.map((segment) => ({ supportedByEvidenceIds: [], ...segment })), uncertain },
    model: "test-model",
    usage: { inputTokens: 1, outputTokens: 1 },
  });
}
function firstMessage(personalization: { messages: MessageArtifact[] }, campaignId = "camp-1") {
  return personalization.messages.find((m) => m.stepId === `${campaignId}-msg1`)!;
}

describe("C2.1 — server-owned evidence, evidenceId construction, workspace isolation", () => {
  it("1/5. evidenceIds are positional, deterministic, and sent to the model as [eN] markers over real message text", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-a", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-b", "conv-1", { direction: "outbound", body: "Je vous recontacte au sujet du devis.", effectiveTime: "2026-02-01T10:00:00.000Z" });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Une question simple, sans affirmation ?" }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    const prompt = generateStructuredMock.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("[e0] Le prospect a écrit");
    expect(prompt).toContain("[e1] Vous avez écrit");
    expect(prompt).toContain("Le devis vous intéresse toujours ?");
  });

  it("4. an empty body is excluded from evidence — never becomes a synthesized fact", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-empty", "conv-1", { direction: "inbound", body: "", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-real", "conv-1", { direction: "inbound", body: "Bonjour, merci pour votre message.", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.personalization.evidence.observedFacts.some((fact) => fact.value === "")).toBe(false);
    expect(result.personalization.evidence.observedFacts.filter((fact) => fact.type === "conversation_inbound")).toHaveLength(1);
  });

  it("16. no Conversation at all -> deterministic fallback, no AI call attempted", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    // Deliberately no seedConversation() call at all.

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
    expect(firstMessage(result.personalization).generatedText).toBe("Bonjour Awa, je me permets de revenir vers vous.");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("17. a Conversation with zero exploitable (non-empty) messages -> deterministic fallback, no AI call", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-draft", "conv-1", { status: "draft", body: "brouillon" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("2/17b. outbound-only Conversation never calls the AI provider — no inbound evidence can ever ground a prospect claim", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-out", "conv-1", { direction: "outbound", body: "Je peux vous envoyer le devis demain." });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("30. workspace isolation — a Conversation belonging to another workspace is never used as evidence", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-other-ws", "contact-1", { workspaceId: "ws-2" });
    seedMessage("msg-other-ws", "conv-other-ws", { workspaceId: "ws-2", direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});

describe("C2.2 — segment validation, inbound/outbound provenance", () => {
  it("1/11/25. a factual segment genuinely supported by real inbound evidence is accepted as ai_grounded", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse, vous devez en reparler avec votre associé." });
    mockSegmentedWhatsAppGeneration([
      { kind: "generic", text: "Je reviens vers vous." },
      { kind: "factual", text: "Le devis vous intéresse toujours", supportedByEvidenceIds: ["e0"] },
    ]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const message = firstMessage(result.personalization);
    expect(message.generationMode).toBe("ai_grounded");
    expect(message.generatedText).toBe("Je reviens vers vous. Le devis vous intéresse toujours");
    expect(result.personalization.aiModel).toBe("test-model");
  });

  it("3. mixed inbound+outbound — a factual segment citing the inbound message is accepted, provenance respected", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-out", "conv-1", { direction: "outbound", body: "Je vous envoie le devis dans la journée.", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-in", "conv-1", { direction: "inbound", body: "Le devis vous intéresse, merci !", effectiveTime: "2026-02-01T10:00:00.000Z" });
    mockSegmentedWhatsAppGeneration([{ kind: "factual", text: "le devis vous intéresse", supportedByEvidenceIds: ["e1"] }]); // e1 = inbound

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("ai_grounded");
  });

  it("6/7. a factual segment citing a hallucinated evidenceId (never constructed server-side) rejects the whole generation", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message, à bientôt." });
    mockSegmentedWhatsAppGeneration([{ kind: "factual", text: "une relance simple", supportedByEvidenceIds: ["e99"] }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const message = firstMessage(result.personalization);
    expect(message.generationMode).toBe("deterministic_fallback");
    expect(message.generatedText).toBe("Bonjour Awa, je me permets de revenir vers vous.");
  });

  it("8. a factual segment declared with zero supportedByEvidenceIds is rejected (an admitted-unsupported claim)", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    mockSegmentedWhatsAppGeneration([{ kind: "factual", text: "le devis vous intéresse", supportedByEvidenceIds: [] }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("9/19. a prospect-state factual segment citing only an outbound evidence is rejected — what-we-said never becomes prospect intent", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { company: "Acme" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-out", "conv-1", { direction: "outbound", body: "Le devis vous intéresse, je vous le confirme.", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-in", "conv-1", { direction: "inbound", body: "Merci, à bientôt.", effectiveTime: "2026-02-01T10:00:00.000Z" });
    mockSegmentedWhatsAppGeneration([{ kind: "factual", text: "le devis vous intéresse", supportedByEvidenceIds: ["e0"] }]); // e0 = outbound

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("10. a factual segment with insufficient lexical overlap with its cited evidence is rejected (conservative, no fuzzy matching)", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "On verra ça plus tard, merci." });
    mockSegmentedWhatsAppGeneration([{ kind: "factual", text: "le budget du projet est confirmé", supportedByEvidenceIds: ["e0"] }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("a genuine open question with a single generic segment (no factual content) is accepted", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message, je reviens vers vous bientôt." });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Bonjour Awa, avez-vous eu l'occasion d'avancer de votre côté ?" }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("ai_grounded");
  });
});

describe("C2.5 — adversarial: an undeclared/mislabeled factual claim can no longer hide in a \"generic\" segment", () => {
  it("adversarial 1/3. a paraphrase of real evidence, mislabeled \"generic\" and using vocabulary outside the closed regex, is rejected", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    // Neither "déménagement", "bureaux" nor "mars" appear in
    // PROSPECT_STATE_ASSERTION's closed word list — the OLD regex-only
    // backstop would never have caught this reformulation.
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Nous prévoyons un déménagement de nos bureaux en mars." });
    mockSegmentedWhatsAppGeneration([
      { kind: "generic", text: "Le déménagement de vos bureaux prévu en mars, ça avance ?" }, // mislabeled: this IS a prospect-state claim
    ]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("adversarial 2. an innocent declared segment does not launder a second, undeclared factual segment elsewhere in the message", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Nous prévoyons un déménagement de nos bureaux en mars." });
    mockSegmentedWhatsAppGeneration([
      { kind: "generic", text: "Bonjour Awa," }, // genuinely innocent
      { kind: "generic", text: "le déménagement de vos bureaux en mars avance-t-il ?" }, // hidden claim, no evidence cited
    ]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const message = firstMessage(result.personalization);
    expect(message.generationMode).toBe("deterministic_fallback");
    expect(message.generatedText).toBe("Bonjour Awa, je me permets de revenir vers vous.");
  });

  it("adversarial 7. a correctly-declared factual segment does not save the message when another segment hides a second, undeclared claim", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse, et nous prévoyons un déménagement de nos bureaux en mars." });
    mockSegmentedWhatsAppGeneration([
      { kind: "factual", text: "le devis vous intéresse", supportedByEvidenceIds: ["e0"] }, // legitimate, correctly declared
      { kind: "generic", text: "et le déménagement de vos bureaux en mars avance bien ?" }, // second, hidden claim
    ]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("adversarial 4/8. purely generic/relational segments with no real connection to evidence content are accepted, not rejected artificially", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Nous prévoyons un déménagement de nos bureaux en mars." });
    mockSegmentedWhatsAppGeneration([
      { kind: "generic", text: "Bonjour Awa, j'espère que vous allez bien." },
      { kind: "generic", text: "Je me permets de revenir vers vous — est-ce toujours d'actualité ?" },
    ]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const message = firstMessage(result.personalization);
    expect(message.generationMode).toBe("ai_grounded");
    expect(message.generatedText).toBe("Bonjour Awa, j'espère que vous allez bien. Je me permets de revenir vers vous — est-ce toujours d'actualité ?");
  });

  it("a generic segment citing an evidenceId is a contradiction and is rejected outright", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message." });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Merci pour votre retour !", supportedByEvidenceIds: ["e0"] }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("a factual segment matching the closed PROSPECT_STATE_ASSERTION vocabulary but mislabeled generic is still caught by the cheap regex layer", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message." });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Votre priorité est de signer le devis rapidement." }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });
});

describe("C2.3 — uncertain flag, provider failure modes, length limit", () => {
  it("12. uncertain=true forces the deterministic fallback even when every other check would have passed", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    mockSegmentedWhatsAppGeneration(
      [{ kind: "factual", text: "le devis vous intéresse", supportedByEvidenceIds: ["e0"] }],
      true,
    );

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("13/26. provider null falls back safely without throwing", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    // getAIProviderMock defaults to null (see beforeEach).

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const message = firstMessage(result.personalization);
    expect(message.generationMode).toBe("deterministic_fallback");
    expect(message.generatedText).toBe("Bonjour Awa, je me permets de revenir vers vous.");
  });

  it("14. a provider exception falls back safely without throwing", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock.mockRejectedValueOnce(new Error("Le fournisseur IA a mis trop de temps à répondre."));

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("15. a malformed structured output (missing segments entirely) falls back safely without throwing", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    getAIProviderMock.mockReturnValue({ model: "test-model", generateStructured: generateStructuredMock });
    generateStructuredMock.mockResolvedValueOnce({ data: { text: "incomplet" }, model: "test-model", usage: { inputTokens: 1, outputTokens: 1 } });

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("15b. an empty segments array falls back safely", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    mockSegmentedWhatsAppGeneration([]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("deterministic_fallback");
  });

  it("22. a reconstructed message exactly at the 320-character limit is accepted when otherwise grounded", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    const prefix = "Merci pour votre retour, je reviens vers vous tres vite ";
    const text = prefix + "x".repeat(320 - prefix.length);
    expect(text.length).toBe(320);
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(firstMessage(result.personalization).generationMode).toBe("ai_grounded");
  });

  it("23. a reconstructed message over 320 characters is rejected OUTRIGHT — never truncated to fit", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { first_name: "Awa", display_name: "Awa Traoré" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    const longText = `Merci pour votre retour, je reviens vers vous tres vite ${"x".repeat(300)}`;
    expect(longText.length).toBeGreaterThan(320);
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: longText }]);

    const result = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const message = firstMessage(result.personalization);
    expect(message.generationMode).toBe("deterministic_fallback");
    expect(message.generatedText).toBe("Bonjour Awa, je me permets de revenir vers vous.");
    expect(message.generatedText).not.toContain(longText.slice(0, 320)); // never a truncated slice of the rejected text
    expect(message.generatedText!.length).toBeLessThanOrEqual(320);
  });
});

describe("C2.4 — Business Context / Contact separation, follow_up vs reactivation, approved-artifact safety", () => {
  it("18. Business Context is placed in its own labeled section, never inside CONVERSATION EVIDENCE", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message." });
    getActiveBusinessContextMock.mockResolvedValue({
      companyName: "Talvia", businessDescription: "Nous aidons les agences à automatiser leurs relances commerciales.",
    } as BusinessContextRecord);
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Merci pour votre retour, à bientôt !" }]);

    await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    const prompt = generateStructuredMock.mock.calls[0]![0].prompt as string;
    const evidenceSection = prompt.split("=== CONTACT FACTS")[0]!;
    expect(prompt).toContain("=== BUSINESS FACTS");
    expect(prompt).toContain("Nous aidons les agences à automatiser leurs relances commerciales.");
    expect(evidenceSection).not.toContain("automatiser leurs relances");
  });

  it("19b. Contact company is placed in its own labeled section, never inside CONVERSATION EVIDENCE", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1", { company: "Nova Studio" });
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message." });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Merci pour votre retour, à bientôt !" }]);

    await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    const prompt = generateStructuredMock.mock.calls[0]![0].prompt as string;
    const evidenceSection = prompt.split("=== CONTACT FACTS")[0]!;
    expect(prompt).toContain("=== CONTACT FACTS");
    expect(prompt).toContain("Nova Studio");
    expect(evidenceSection).not.toContain("Nova Studio");
  });

  it("20. objective=follow_up shapes the tone-policy prompt section and forbids inventing an open action", async () => {
    seedWhatsAppCampaignSingleStep("camp-1", { objective: "follow_up" });
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message." });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Merci pour votre retour, à bientôt !" }]);

    await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    const prompt = generateStructuredMock.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("Suivi (follow_up)");
    expect(prompt).toMatch(/N'affirme JAMAIS qu'une action précise/);
  });

  it("21. objective=reactivation shapes a softer tone-policy prompt section without inventing a reason for silence", async () => {
    seedWhatsAppCampaignSingleStep("camp-1", { objective: "reactivation" });
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Merci pour votre message." });
    mockSegmentedWhatsAppGeneration([{ kind: "generic", text: "Cela fait un moment, comment allez-vous ?" }]);

    await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    const prompt = generateStructuredMock.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("Réactivation");
    expect(prompt).toMatch(/sans jamais supposer ou expliquer pourquoi/);
  });

  it("24. an approved artifact is never overwritten even when a fresh AI-grounded generation would otherwise succeed", async () => {
    seedWhatsAppCampaignSingleStep("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedContact("contact-1");
    const before = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");
    if (!before.ok) throw new Error("unreachable");
    await approveParticipantMessage(context, "camp-1", "part-1", "camp-1-msg1");
    const approvedTextBefore = (await getParticipantPersonalization(context, "camp-1", "part-1"))!.messages.find((m) => m.stepId === "camp-1-msg1")!.approvedText;

    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis vous intéresse toujours ?" });
    mockSegmentedWhatsAppGeneration([{ kind: "factual", text: "le devis vous intéresse", supportedByEvidenceIds: ["e0"] }]);

    const after = await generateWhatsAppParticipantPersonalization(context, "camp-1", "part-1");

    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("unreachable");
    const message = firstMessage(after.personalization);
    expect(message.status).toBe("approved");
    expect(message.approvedText).toBe(approvedTextBefore);
    expect(generateStructuredMock).not.toHaveBeenCalled(); // never even attempted for an approved step
  });

  it("27. LinkedIn personalization is unaffected — its message artifacts never carry a generationMode", async () => {
    seedCampaign("camp-1");
    seedParticipant("camp-1", "part-1", "contact-1");
    seedCandidate("camp-1", "contact-1", { headline: "Fondatrice", company: "Acme" });

    const result = await generateParticipantPersonalization(context, "camp-1", "part-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    for (const message of result.personalization.messages) expect(message.generationMode).toBeUndefined();
  });
});

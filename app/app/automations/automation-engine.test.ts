import { describe, expect, it } from "vitest";
import { createInitialSandboxState } from "../state/reducer";
import { runAutomations } from "./automation-engine";

describe("automation engine", () => {
  it("marks a conversation as priority on an incoming message", () => {
    const state = { ...createInitialSandboxState(), conversations: [{ id: "c1", contactId: "p1", channel: "linkedin" as const, createdAt: "2026-01-01" }], automations: [{ id: "a1", name: "Priorité", trigger: "", event: "message_received" as const, channel: "linkedin" as const, action: "mark_priority", enabled: true }] };
    expect(runAutomations(state, { type: "message_received", conversationId: "c1", contactId: "p1", channel: "linkedin" }).conversations?.[0].unread).toBe(true);
  });
  it("does not execute an inactive rule", () => {
    const state = { ...createInitialSandboxState(), automations: [{ id: "a1", name: "Inactive", trigger: "", event: "message_received" as const, channel: "linkedin" as const, action: "prepare_draft", enabled: false }] };
    expect(runAutomations(state, { type: "message_received", channel: "linkedin" }).activities).toBeUndefined();
  });
  it("adds a proposal follow-up through the shared engine", () => {
    const state = { ...createInitialSandboxState(), opportunities: [{ id: "o1", title: "Site", stage: "proposal" as const }], automations: [{ id: "a1", name: "Relance", trigger: "", event: "opportunity_proposal" as const, channel: "gmail" as const, action: "create_follow_up", enabled: true }] };
    expect(runAutomations(state, { type: "opportunity_proposal", opportunityId: "o1", channel: "gmail" }).opportunities[0].nextAction).toBe("Relancer la proposition");
  });
});

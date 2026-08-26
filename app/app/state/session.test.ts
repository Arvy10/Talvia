import { afterEach, describe, expect, it } from "vitest";

import { initialSandboxState } from "./reducer";
import { activateSandboxSession } from "./session";
import { loadSandboxState, sandboxStorageKey } from "./storage";

describe("sandbox session activation", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("activates a session without changing existing product data", () => {
    const existingState = {
      ...initialSandboxState,
      storageAvailable: false,
      connections: {
        ...initialSandboxState.connections,
        linkedin: { status: "connected" as const },
      },
      contacts: [{ id: "contact-1", name: "Ada Lovelace" }],
      opportunities: [{ id: "opportunity-1", title: "Proposal", stage: "proposal" as const }],
      automations: [{ id: "automation-1", name: "Test", trigger: "message_received", channel: "gmail" as const, action: "prepare_draft", enabled: true }],
      pipelineView: "list" as const,
    };

    expect(activateSandboxSession(existingState)).toEqual({
      ...existingState,
      sessionActive: true,
    });
  });

  it("activates initial state when saved storage is malformed", () => {
    localStorage.setItem(sandboxStorageKey(null), "not json");

    expect(activateSandboxSession(loadSandboxState(null))).toEqual({
      ...initialSandboxState,
      sessionActive: true,
    });
  });

  it("accepts only sandbox state and never adds credentials to persisted data", () => {
    expect(activateSandboxSession).toHaveLength(1);

    const activeState = activateSandboxSession(initialSandboxState);
    const persistedState = JSON.parse(
      localStorage.getItem(sandboxStorageKey(null)) ?? "{}",
    );

    expect(activeState).not.toHaveProperty("password");
    expect(activeState).not.toHaveProperty("email");
    expect(persistedState).not.toHaveProperty("password");
    expect(persistedState).not.toHaveProperty("email");
  });
});

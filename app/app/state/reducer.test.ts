import { describe, expect, it } from "vitest";

import { initialSandboxState, sandboxReducer } from "./reducer";

describe("sandboxReducer", () => {
  it("starts with every channel disconnected", () => {
    expect(initialSandboxState.connections.linkedin.status).toBe("disconnected");
    expect(initialSandboxState.connections.whatsapp.status).toBe("disconnected");
    expect(initialSandboxState.connections.gmail.status).toBe("disconnected");
  });

  it("sets the status for the selected connection", () => {
    const connected = sandboxReducer(initialSandboxState, {
      type: "SET_CONNECTION_STATUS",
      channel: "linkedin",
      status: "connected",
    });

    expect(connected.connections.linkedin.status).toBe("connected");
    expect(connected.connections.whatsapp.status).toBe("disconnected");
  });

  it("activates the sandbox session through a semantic action", () => {
    const active = sandboxReducer(initialSandboxState, {
      type: "ACTIVATE_SANDBOX_SESSION",
    });

    expect(active.sessionActive).toBe(true);
    expect(active.connections).toBe(initialSandboxState.connections);
    expect(active.contacts).toBe(initialSandboxState.contacts);
  });

  it("resets state to the deterministic defaults", () => {
    const connected = sandboxReducer(initialSandboxState, {
      type: "SET_CONNECTION_STATUS",
      channel: "linkedin",
      status: "connected",
    });

    const reset = sandboxReducer(connected, { type: "RESET_SANDBOX" });

    expect(reset).toEqual(initialSandboxState);
  });

  it("adds a contact without changing unrelated state", () => {
    const result = sandboxReducer(initialSandboxState, {
      type: "CREATE_CONTACT",
      contact: { id: "contact-1", name: "Ada Lovelace" },
    });

    expect(result.contacts).toEqual([{ id: "contact-1", name: "Ada Lovelace" }]);
    expect(result.opportunities).toEqual([]);
    expect(result.automations).toEqual([]);
    expect(result.pipelineView).toBe("pipeline");
  });

  it("adds an opportunity without changing unrelated state", () => {
    const result = sandboxReducer(initialSandboxState, {
      type: "CREATE_OPPORTUNITY",
      opportunity: { id: "opportunity-1", title: "Talvia rollout" },
    });

    expect(result.opportunities).toEqual([
      { id: "opportunity-1", title: "Talvia rollout" },
    ]);
    expect(result.contacts).toEqual([]);
    expect(result.automations).toEqual([]);
    expect(result.pipelineView).toBe("pipeline");
  });

  it("adds an automation without changing unrelated state", () => {
    const result = sandboxReducer(initialSandboxState, {
      type: "CREATE_AUTOMATION",
      automation: { id: "automation-1", name: "Welcome sequence" },
    });

    expect(result.automations).toEqual([
      { id: "automation-1", name: "Welcome sequence" },
    ]);
    expect(result.contacts).toEqual([]);
    expect(result.opportunities).toEqual([]);
    expect(result.pipelineView).toBe("pipeline");
  });

  it("changes the pipeline view without changing collections", () => {
    const result = sandboxReducer(initialSandboxState, {
      type: "SET_PIPELINE_VIEW",
      view: "list",
    });

    expect(result.pipelineView).toBe("list");
    expect(result.contacts).toEqual([]);
    expect(result.opportunities).toEqual([]);
    expect(result.automations).toEqual([]);
  });
});

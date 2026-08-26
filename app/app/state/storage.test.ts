import { afterEach, describe, expect, it, vi } from "vitest";

import { initialSandboxState } from "./reducer";
import { loadSandboxState, sandboxStorageKey, saveSandboxState } from "./storage";

const validContact = {
  id: "contact-1",
  name: "Persona Synthétique",
  email: "persona@example.test",
  phone: "+000 000 000",
  channel: "linkedin",
};

const validOpportunity = {
  id: "opportunity-1",
  title: "Essai synthétique",
  stage: "proposal",
  organization: "Organisation fictive",
};

const validAutomation = {
  id: "automation-1",
  name: "Flux synthétique",
  trigger: "Message de test reçu",
  channel: "gmail",
  action: "Préparer un brouillon de test",
  enabled: true,
};

const validPersistedSnapshot = {
  schemaVersion: 1,
  sessionActive: true,
  connections: initialSandboxState.connections,
  contacts: [validContact],
  opportunities: [validOpportunity],
  automations: [validAutomation],
  pipelineView: "pipeline",
};

describe("sandbox storage", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns defaults when no saved state exists", () => {
    expect(loadSandboxState(null)).toEqual(initialSandboxState);
  });

  it("returns defaults for malformed saved state", () => {
    localStorage.setItem(sandboxStorageKey(null), "not json");

    expect(loadSandboxState(null)).toEqual(initialSandboxState);
  });

  it("returns defaults for a saved state from another schema version", () => {
    localStorage.setItem(
      sandboxStorageKey(null),
      JSON.stringify({ ...initialSandboxState, schemaVersion: 2 }),
    );

    expect(loadSandboxState(null)).toEqual(initialSandboxState);
  });

  it("returns a valid saved snapshot", () => {
    const saved = {
      ...validPersistedSnapshot,
      connections: {
        ...initialSandboxState.connections,
        gmail: { status: "connected" as const },
      },
    };
    localStorage.setItem(sandboxStorageKey(null), JSON.stringify(saved));

    expect(loadSandboxState(null)).toEqual({
      ...saved,
      storageAvailable: true,
    });
  });

  it.each([
    ["contact id", { contacts: [{ ...validContact, id: 42 }] }],
    ["contact name", { contacts: [{ ...validContact, name: false }] }],
    ["contact email", { contacts: [{ ...validContact, email: 42 }] }],
    ["contact phone", { contacts: [{ ...validContact, phone: {} }] }],
    ["contact channel", { contacts: [{ ...validContact, channel: "instagram" }] }],
    ["opportunity id", { opportunities: [{ ...validOpportunity, id: null }] }],
    ["opportunity title", { opportunities: [{ ...validOpportunity, title: [] }] }],
    ["opportunity stage", { opportunities: [{ ...validOpportunity, stage: "closed" }] }],
    ["opportunity organization", { opportunities: [{ ...validOpportunity, organization: 42 }] }],
    ["automation id", { automations: [{ ...validAutomation, id: false }] }],
    ["automation name", { automations: [{ ...validAutomation, name: null }] }],
    ["automation trigger", { automations: [{ ...validAutomation, trigger: {} }] }],
    ["automation channel", { automations: [{ ...validAutomation, channel: "instagram" }] }],
    ["automation action", { automations: [{ ...validAutomation, action: [] }] }],
    ["automation enabled", { automations: [{ ...validAutomation, enabled: "yes" }] }],
  ])("rejects a malformed nested %s field", (_field, invalidCollection) => {
    localStorage.setItem(
      sandboxStorageKey(null),
      JSON.stringify({ ...validPersistedSnapshot, ...invalidCollection }),
    );

    expect(loadSandboxState(null)).toEqual(initialSandboxState);
  });

  it.each(["connecting", "syncing"] as const)(
    "normalizes a hydrated %s connection to disconnected",
    (status) => {
      localStorage.setItem(
        sandboxStorageKey(null),
        JSON.stringify({
          ...initialSandboxState,
          storageAvailable: undefined,
          connections: {
            ...initialSandboxState.connections,
            linkedin: { status },
          },
        }),
      );

      expect(loadSandboxState(null).connections.linkedin.status).toBe(
        "disconnected",
      );
    },
  );

  it.each(["connecting", "syncing"] as const)(
    "persists a %s connection as the stable disconnected state",
    (status) => {
      saveSandboxState({
        ...initialSandboxState,
        connections: {
          ...initialSandboxState.connections,
          linkedin: { status },
        },
      }, null);

      const saved = JSON.parse(localStorage.getItem(sandboxStorageKey(null)) ?? "{}");
      expect(saved.connections.linkedin.status).toBe("disconnected");
    },
  );

  it("does not persist the transient storage availability flag", () => {
    saveSandboxState({ ...initialSandboxState, storageAvailable: false }, null);

    const saved = JSON.parse(localStorage.getItem(sandboxStorageKey(null)) ?? "{}");

    expect(saved).not.toHaveProperty("storageAvailable");
  });

  it("returns defaults when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(loadSandboxState(null)).toEqual(initialSandboxState);
  });

  it("restores availability after storage becomes healthy again", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      });

    loadSandboxState(null);
    getItem.mockRestore();
    localStorage.setItem(sandboxStorageKey(null), JSON.stringify({
      ...initialSandboxState,
      storageAvailable: false,
    }));

    expect(loadSandboxState(null).storageAvailable).toBe(true);
  });

  it("never throws when writing storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => saveSandboxState(initialSandboxState, null)).not.toThrow();
  });
});

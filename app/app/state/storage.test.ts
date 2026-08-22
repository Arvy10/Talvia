import { afterEach, describe, expect, it, vi } from "vitest";

import { initialSandboxState } from "./reducer";
import { loadSandboxState, saveSandboxState, STORAGE_KEY } from "./storage";

describe("sandbox storage", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns defaults when no saved state exists", () => {
    expect(loadSandboxState()).toEqual(initialSandboxState);
  });

  it("returns defaults for malformed saved state", () => {
    localStorage.setItem(STORAGE_KEY, "not json");

    expect(loadSandboxState()).toEqual(initialSandboxState);
  });

  it("returns defaults for a saved state from another schema version", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...initialSandboxState, schemaVersion: 2 }),
    );

    expect(loadSandboxState()).toEqual(initialSandboxState);
  });

  it("returns a valid saved snapshot", () => {
    const { storageAvailable: _storageAvailable, ...saved } = {
      ...initialSandboxState,
      connections: {
        ...initialSandboxState.connections,
        gmail: { status: "connected" as const },
      },
      contacts: [{ id: "contact-1", name: "Ada Lovelace" }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

    expect(loadSandboxState()).toEqual({
      ...saved,
      storageAvailable: true,
    });
  });

  it("does not persist the transient storage availability flag", () => {
    saveSandboxState({ ...initialSandboxState, storageAvailable: false });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

    expect(saved).not.toHaveProperty("storageAvailable");
  });

  it("returns defaults when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(loadSandboxState()).toEqual(initialSandboxState);
  });

  it("restores availability after storage becomes healthy again", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      });

    loadSandboxState();
    getItem.mockRestore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...initialSandboxState,
      storageAvailable: false,
    }));

    expect(loadSandboxState().storageAvailable).toBe(true);
  });

  it("never throws when writing storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => saveSandboxState(initialSandboxState)).not.toThrow();
  });
});

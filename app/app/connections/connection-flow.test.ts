import { describe, expect, it } from "vitest";

import { getNextConnectionStatus, getRecoveredConnectionStatus } from "./connection-flow";

describe("getNextConnectionStatus", () => {
  it.each([
    ["disconnected", "connecting"],
    ["connecting", "syncing"],
    ["syncing", "connected"],
    ["error", "connecting"],
    ["connected", "connected"],
  ] as const)("moves %s to %s", (status, expectedStatus) => {
    expect(getNextConnectionStatus(status)).toBe(expectedStatus);
  });
});

describe("getRecoveredConnectionStatus", () => {
  it.each(["connecting", "syncing"] as const)("recovers a persisted %s status as disconnected", (status) => {
    expect(getRecoveredConnectionStatus(status)).toBe("disconnected");
  });
});

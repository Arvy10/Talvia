import { describe, expect, it } from "vitest";

import { getNextConnectionStatus } from "./connection-flow";

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

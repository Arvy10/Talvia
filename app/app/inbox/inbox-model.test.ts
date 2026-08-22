import { describe, expect, it } from "vitest";

import { initialSandboxState, sandboxReducer } from "../state/reducer";
import { getConnectedChannelCount, getInboxAvailability } from "./inbox-model";

describe("inbox derived state", () => {
  it("keeps every inbox filter unavailable in a fresh sandbox", () => {
    const availability = getInboxAvailability(initialSandboxState.connections);

    expect(getConnectedChannelCount(initialSandboxState)).toBe(0);
    expect(availability).toEqual({
      linkedin: "disconnected",
      whatsapp: "disconnected",
      gmail: "disconnected",
    });
  });

  it("enables only Gmail after it is connected without creating conversations", () => {
    const connectedState = sandboxReducer(initialSandboxState, {
      type: "SET_CONNECTION_STATUS",
      channel: "gmail",
      status: "connected",
    });
    const availability = getInboxAvailability(connectedState.connections);

    expect(getConnectedChannelCount(connectedState)).toBe(1);
    expect(availability).toEqual({
      linkedin: "disconnected",
      whatsapp: "disconnected",
      gmail: "connected-empty",
    });
    expect(Object.values(availability).filter((status) => status === "connected-empty")).toHaveLength(1);
  });
});

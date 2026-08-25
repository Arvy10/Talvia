import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingGate } from "./OnboardingGate";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

function stubFetch(businessContext: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ businessContext }) }));
}

describe("OnboardingGate", () => {
  it("never shows on the /app/onboarding route itself", async () => {
    stubFetch(null);
    render(<OnboardingGate pathname="/app/onboarding" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the overlay when no profile exists yet", async () => {
    stubFetch(null);
    render(<OnboardingGate pathname="/app/dashboard" />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("does not show when the profile is already ready", async () => {
    stubFetch({ status: "ready" });
    render(<OnboardingGate pathname="/app/dashboard" />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("respects a session-scoped defer", async () => {
    window.sessionStorage.setItem("talvia:onboarding-deferred", "true");
    stubFetch(null);
    render(<OnboardingGate pathname="/app/dashboard" />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

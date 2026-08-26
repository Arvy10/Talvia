import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sandboxStorageKey } from "../state/storage";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("../../lib/auth-client");
});

async function renderWithMockedAuth(authClient: { getSession: () => Promise<unknown>; signOut: () => Promise<unknown> }) {
  vi.doMock("../../lib/auth-client", () => ({ authClient }));
  const { SignOutButton } = await import("./SignOutButton");
  render(<SignOutButton />);
}

// jsdom's window.location.assign isn't directly spyable (non-configurable
// on the prototype) — replace the whole `location` object instead.
function stubLocationAssign() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { assign } });
  return assign;
}

describe("SignOutButton", () => {
  it("clears the signed-in user's local sandbox data and redirects on a successful sign-out", async () => {
    const assign = stubLocationAssign();
    await renderWithMockedAuth({
      getSession: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      signOut: () => Promise.resolve({ data: {}, error: null }),
    });
    localStorage.setItem(sandboxStorageKey("user-1"), JSON.stringify({ contacts: ["should be cleared"] }));

    fireEvent.click(screen.getByRole("button", { name: /Se déconnecter/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Se déconnecter/ })[1]!);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(localStorage.getItem(sandboxStorageKey("user-1"))).toBeNull();
  });

  it("shows an error and does not redirect when the server-side sign-out fails", async () => {
    const assign = stubLocationAssign();
    await renderWithMockedAuth({
      getSession: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      signOut: () => Promise.resolve({ data: null, error: { message: "revoke failed" } }),
    });
    localStorage.setItem(sandboxStorageKey("user-1"), JSON.stringify({ contacts: ["still here"] }));

    fireEvent.click(screen.getByRole("button", { name: /Se déconnecter/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Se déconnecter/ })[1]!);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/échoué/));
    expect(assign).not.toHaveBeenCalled();
    // A failed revoke must not wipe local data either — the session may
    // still be active server-side.
    expect(localStorage.getItem(sandboxStorageKey("user-1"))).not.toBeNull();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectionStatus } from "../state/types";
import { ConnectionsClient } from "./ConnectionsClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConnectionsClient", () => {
  it.each(["connecting", "syncing"] as const)(
    "persists a %s local connection status through the API",
    async (status: ConnectionStatus) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input) === "/api/connections" && !init) {
          return new Response(JSON.stringify({ connections: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ connection: { channel_type: "linkedin", status } }), { status: 200 });
      });

      render(<ConnectionsClient />);
      const select = await screen.findByRole("combobox", { name: "État LinkedIn" });
      fireEvent.change(select, { target: { value: status } });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/connections",
        expect.objectContaining({ method: "PATCH" }),
      ));
      expect((select as HTMLSelectElement).value).toBe(status);
    },
  );

  // The real technical detail lives in connections.metadata.sync.error,
  // already sanitized server-side (sanitizeSyncError in unipile-adapter.ts)
  // before GET /api/connections ever exposes it — these tests only prove
  // the UI actually surfaces what it's given, prefixed clearly, instead of
  // a bare undiagnosable "failed".
  function mockConnectionsResponse(sync: { status: string; chatsProcessed: number; messagesImported: number; chatsSkippedGroups: number; chatsFailed: number; error: string | null } | null) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/connections" && !init) {
        return new Response(JSON.stringify({
          connections: [{ id: "conn-wa-1", provider: "unipile", channel_type: "whatsapp", status: "connected", display_name: "WhatsApp", connected_at: new Date().toISOString(), last_synced_at: null, sync }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    });
  }

  it("a failed sync with a real error shows it, clearly prefixed", async () => {
    mockConnectionsResponse({ status: "failed", chatsProcessed: 3, messagesImported: 243, chatsSkippedGroups: 1, chatsFailed: 0, error: "Appel à Unipile en échec (HTTP 429)." });

    render(<ConnectionsClient />);

    await screen.findByText("Synchronisation échouée : Appel à Unipile en échec (HTTP 429)."); // throws if not found
  });

  it("a failed sync with no stored error still shows a clear, non-empty fallback", async () => {
    mockConnectionsResponse({ status: "failed", chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: null });

    render(<ConnectionsClient />);

    await screen.findByText("Synchronisation échouée : erreur inconnue."); // throws if not found
  });

  it("never renders anything beyond the sanitized error field itself — no secret/token/raw payload leak from the UI layer", async () => {
    mockConnectionsResponse({ status: "failed", chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: "Appel à Unipile en échec (HTTP 500)." });

    render(<ConnectionsClient />);
    await screen.findByText("Synchronisation échouée : Appel à Unipile en échec (HTTP 500).");

    expect(document.body.textContent).not.toMatch(/token|secret|authorization|bearer/i);
  });
});

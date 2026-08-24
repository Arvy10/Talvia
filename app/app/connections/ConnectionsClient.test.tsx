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
});

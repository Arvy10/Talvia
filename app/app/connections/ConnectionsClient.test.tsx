import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SandboxProvider, useSandbox } from "../state/SandboxProvider";
import type { ConnectionStatus } from "../state/types";
import { ConnectionsClient } from "./ConnectionsClient";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function RouteHarness() {
  const { hydrated, state } = useSandbox();
  const [showConnections, setShowConnections] = useState(true);

  return (
    <>
      <output aria-label="hydration">{hydrated ? "ready" : "loading"}</output>
      <output aria-label="linkedin-status">
        {state.connections.linkedin.status}
      </output>
      <button onClick={() => setShowConnections(false)} type="button">
        Quitter Connexions
      </button>
      {showConnections ? <ConnectionsClient /> : null}
    </>
  );
}

describe("Connections route cleanup", () => {
  it.each(["connecting", "syncing"] as const)(
    "recovers a current %s channel when the route unmounts",
    async (status: ConnectionStatus) => {
      render(
        <SandboxProvider>
          <RouteHarness />
        </SandboxProvider>,
      );

      await waitFor(() => {
        expect(screen.getByLabelText("hydration").textContent).toBe("ready");
      });
      fireEvent.change(screen.getByRole("combobox", { name: "État LinkedIn" }), {
        target: { value: status },
      });
      await waitFor(() => {
        expect(screen.getByLabelText("linkedin-status").textContent).toBe(status);
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Quitter Connexions" }),
      );

      await waitFor(() => {
        expect(screen.getByLabelText("linkedin-status").textContent).toBe(
          "disconnected",
        );
      });
    },
  );
});

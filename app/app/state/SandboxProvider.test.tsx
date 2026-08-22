import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialSandboxState } from "./reducer";
import { SandboxProvider, useSandbox } from "./SandboxProvider";
import { STORAGE_KEY } from "./storage";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function ProviderProbe() {
  const { dispatch, hydrated, state } = useSandbox();

  return (
    <div>
      <output aria-label="hydration">{hydrated ? "ready" : "loading"}</output>
      <output aria-label="session">{state.sessionActive ? "active" : "inactive"}</output>
      <output aria-label="storage">
        {state.storageAvailable ? "available" : "unavailable"}
      </output>
      <button
        onClick={() =>
          dispatch({
            type: "SET_PIPELINE_VIEW",
            view: state.pipelineView === "pipeline" ? "list" : "pipeline",
          })
        }
        type="button"
      >
        Changer la vue
      </button>
    </div>
  );
}

describe("SandboxProvider", () => {
  it("activates and persists an inactive session after direct product hydration", async () => {
    const { storageAvailable: _storageAvailable, ...inactiveSnapshot } =
      initialSandboxState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inactiveSnapshot));

    render(
      <SandboxProvider>
        <ProviderProbe />
      </SandboxProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("hydration").textContent).toBe("ready");
      expect(screen.getByLabelText("session").textContent).toBe("active");
      expect(
        JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").sessionActive,
      ).toBe(true);
    });
  });

  it("reports a failed save and recovers after the next successful save", async () => {
    render(
      <SandboxProvider>
        <ProviderProbe />
      </SandboxProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("hydration").textContent).toBe("ready");
      expect(screen.getByLabelText("storage").textContent).toBe("available");
    });

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable once");
      })
      .mockImplementation(function (key, value) {
        return originalSetItem.call(this, key, value);
      });

    fireEvent.click(screen.getByRole("button", { name: "Changer la vue" }));
    await waitFor(() => {
      expect(screen.getByLabelText("storage").textContent).toBe("unavailable");
    });

    fireEvent.click(screen.getByRole("button", { name: "Changer la vue" }));
    await waitFor(() => {
      expect(screen.getByLabelText("storage").textContent).toBe("available");
    });
  });
});

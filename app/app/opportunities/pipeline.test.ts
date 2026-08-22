import { describe, expect, it } from "vitest";

import { initialSandboxState, sandboxReducer } from "../state/reducer";
import { PIPELINE_STAGES } from "./pipeline";

describe("opportunity pipeline", () => {
  it("exposes the five customer-facing stages in sales order", () => {
    expect(PIPELINE_STAGES).toEqual([
      ["new", "Nouveau"],
      ["qualified", "Qualifié"],
      ["proposal", "Proposition"],
      ["negotiation", "Négociation"],
      ["won", "Gagné"],
    ]);
  });

  it("keeps a selected list view in sandbox state", () => {
    const selectedListView = sandboxReducer(initialSandboxState, {
      type: "SET_PIPELINE_VIEW",
      view: "list",
    });

    expect(selectedListView.pipelineView).toBe("list");
  });
});

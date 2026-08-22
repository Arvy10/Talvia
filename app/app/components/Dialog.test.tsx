import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import { Dialog } from "./Dialog";

afterEach(cleanup);

function ControlledDialog() {
  const [value, setValue] = useState("");

  return (
    <Dialog onClose={() => undefined} open title="Modifier le contact">
      <label>
        Nom
        <input
          aria-label="Nom"
          onChange={(event) => setValue(event.target.value)}
          value={value}
        />
      </label>
    </Dialog>
  );
}

describe("Dialog focus lifecycle", () => {
  it("keeps focus in a controlled field while multiple characters are typed", () => {
    render(<ControlledDialog />);
    const input = screen.getByRole("textbox", { name: "Nom" });
    input.focus();

    for (const value of ["S", "Sy", "Syn", "Synt", "Synth"]) {
      fireEvent.change(input, { target: { value } });
      expect(document.activeElement).toBe(input);
    }

    expect((input as HTMLInputElement).value).toBe("Synth");
  });
});

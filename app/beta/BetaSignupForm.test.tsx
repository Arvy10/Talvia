import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BetaSignupForm } from "./BetaSignupForm";

describe("BetaSignupForm", () => {
  test("submits the minimal opt-in data with URL attribution", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BetaSignupForm search="?utm_source=linkedin&utm_campaign=beta" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ada@example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: "Tester Talvia" }).closest("form")!);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/acquisition/beta");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("linkedin");
  });
});

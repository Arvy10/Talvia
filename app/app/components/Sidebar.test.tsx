import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar", () => {
  it("uses the Talvia mark as the desktop navigation toggle", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Sidebar collapsed={false} onToggle={onToggle} pathname="/app" />);

    fireEvent.click(screen.getByRole("button", { name: "Réduire la navigation" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<Sidebar collapsed onToggle={onToggle} pathname="/app" />);
    expect(screen.getByRole("button", { name: "Agrandir la navigation" })).toBeTruthy();
  });
});

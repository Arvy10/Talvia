import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChipBand } from "./ChipBand";

afterEach(cleanup);

describe("ChipBand", () => {
  it("calls onChange with the clicked preset option", () => {
    const onChange = vi.fn();
    render(<ChipBand onChange={onChange} options={["Logiciel / SaaS", "E-commerce"]} value="" />);
    fireEvent.click(screen.getByRole("button", { name: "E-commerce" }));
    expect(onChange).toHaveBeenCalledWith("E-commerce");
  });

  it("marks the current value's chip as selected", () => {
    render(<ChipBand onChange={vi.fn()} options={["Logiciel / SaaS", "E-commerce"]} value="E-commerce" />);
    expect(screen.getByRole("button", { name: "E-commerce" }).className).toContain("is-selected");
    expect(screen.getByRole("button", { name: "Logiciel / SaaS" }).className).not.toContain("is-selected");
  });

  it("switches to free text when 'Autre' is clicked, and reports typed text", () => {
    const onChange = vi.fn();
    render(<ChipBand onChange={onChange} options={["Logiciel / SaaS"]} value="" />);
    fireEvent.click(screen.getByRole("button", { name: "Autre" }));
    const input = screen.getByPlaceholderText("Précisez votre secteur…");
    fireEvent.change(input, { target: { value: "Artisanat du bois" } });
    expect(onChange).toHaveBeenCalledWith("Artisanat du bois");
  });

  it("treats a value outside the preset list as already in custom mode", () => {
    render(<ChipBand onChange={vi.fn()} options={["Logiciel / SaaS"]} value="Un secteur non listé" />);
    expect(screen.getByDisplayValue("Un secteur non listé")).toBeTruthy();
  });
});

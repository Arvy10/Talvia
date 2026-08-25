import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndustrySelect } from "./IndustrySelect";

afterEach(cleanup);

describe("IndustrySelect", () => {
  it("starts closed, showing a placeholder", () => {
    render(<IndustrySelect onChange={vi.fn()} value="" />);
    expect(screen.getByText("Choisir un secteur…")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens the list on click and selects an option", () => {
    const onChange = vi.fn();
    render(<IndustrySelect onChange={onChange} value="" />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un secteur/ }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "E-commerce" }));
    expect(onChange).toHaveBeenCalledWith("E-commerce");
  });

  it("closes after a selection", () => {
    render(<IndustrySelect onChange={vi.fn()} value="" />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un secteur/ }));
    fireEvent.click(screen.getByRole("button", { name: "E-commerce" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters the list as the user types a keyword", () => {
    render(<IndustrySelect onChange={vi.fn()} value="" />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un secteur/ }));
    fireEvent.change(screen.getByPlaceholderText(/Rechercher un secteur/), { target: { value: "santé" } });
    expect(screen.getByRole("button", { name: "Santé" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "E-commerce" })).toBeNull();
  });

  it("offers to use a typed value that isn't in the preset list", () => {
    const onChange = vi.fn();
    render(<IndustrySelect onChange={onChange} value="" />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un secteur/ }));
    fireEvent.change(screen.getByPlaceholderText(/Rechercher un secteur/), { target: { value: "Artisanat du bois" } });
    fireEvent.click(screen.getByRole("button", { name: "Utiliser « Artisanat du bois »" }));
    expect(onChange).toHaveBeenCalledWith("Artisanat du bois");
  });
});

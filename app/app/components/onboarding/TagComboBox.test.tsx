import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TagComboBox } from "./TagComboBox";

afterEach(cleanup);

describe("TagComboBox", () => {
  // Regression test: the suggestions panel used to default to the full
  // option list when the search query was empty, which meant it rendered
  // permanently (not just while searching) and could sit on top of the
  // fields/buttons below it — the reported "stuck, can't click, can't
  // save" bug on the onboarding "Cible" step, where several of these are
  // stacked in the same screen.
  it("shows no suggestions until the user types something", () => {
    render(<TagComboBox onChange={vi.fn()} options={["PME", "Startups", "Agences"]} value={[]} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters suggestions as the user types and adds the clicked option", () => {
    const onChange = vi.fn();
    render(<TagComboBox onChange={onChange} options={["PME", "Startups", "Agences"]} value={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Rechercher…"), { target: { value: "PM" } });
    fireEvent.click(screen.getByRole("button", { name: "PME" }));
    expect(onChange).toHaveBeenCalledWith(["PME"]);
  });

  it("closes the panel again after a selection", () => {
    render(<TagComboBox onChange={vi.fn()} options={["PME", "Startups"]} value={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Rechercher…"), { target: { value: "PM" } });
    fireEvent.click(screen.getByRole("button", { name: "PME" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the panel on outside click without adding anything", () => {
    const onChange = vi.fn();
    render(<div><TagComboBox onChange={onChange} options={["PME", "Startups"]} value={[]} /><button type="button">Ailleurs</button></div>);
    fireEvent.change(screen.getByPlaceholderText("Rechercher…"), { target: { value: "PM" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Ailleurs" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers to add a custom value not in the preset list", () => {
    const onChange = vi.fn();
    render(<TagComboBox onChange={onChange} options={["PME"]} value={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Rechercher…"), { target: { value: "Cabinets médicaux" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter « Cabinets médicaux »" }));
    expect(onChange).toHaveBeenCalledWith(["Cabinets médicaux"]);
  });

  it("does not offer a custom-add option when allowCustom is false", () => {
    render(<TagComboBox allowCustom={false} onChange={vi.fn()} options={["PME"]} value={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Rechercher…"), { target: { value: "Inconnu" } });
    expect(screen.queryByText(/Ajouter/)).toBeNull();
  });

  it("removes a value when its chip's remove button is clicked", () => {
    const onChange = vi.fn();
    render(<TagComboBox onChange={onChange} options={["PME", "Startups"]} value={["PME", "Startups"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Retirer PME" }));
    expect(onChange).toHaveBeenCalledWith(["Startups"]);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CountryMultiSelect } from "./CountryMultiSelect";

afterEach(cleanup);

describe("CountryMultiSelect", () => {
  it("shows no suggestions until the user types", () => {
    render(<CountryMultiSelect onChange={vi.fn()} value={[]} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters suggestions as the user types and adds the clicked country", () => {
    const onChange = vi.fn();
    render(<CountryMultiSelect onChange={onChange} value={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Rechercher un pays…"), { target: { value: "Fra" } });
    const option = screen.getByRole("button", { name: "France" });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(["France"]);
  });

  it("does not suggest a country already selected", () => {
    render(<CountryMultiSelect onChange={vi.fn()} value={["France"]} />);
    fireEvent.change(screen.getByPlaceholderText("Rechercher un pays…"), { target: { value: "Fra" } });
    expect(screen.queryByRole("button", { name: "France" })).toBeNull();
  });

  it("removes a country when its chip's remove button is clicked", () => {
    const onChange = vi.fn();
    render(<CountryMultiSelect onChange={onChange} value={["France", "Belgique"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Retirer France" }));
    expect(onChange).toHaveBeenCalledWith(["Belgique"]);
  });
});

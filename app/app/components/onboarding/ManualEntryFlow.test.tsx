import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManualEntryFlow } from "./ManualEntryFlow";

afterEach(cleanup);

function fillIdentityAndOffer(companyName = "Fayluméa", description = "Nous créons des sites web pour les entreprises.") {
  fireEvent.change(screen.getByPlaceholderText("Ex : Fayluméa"), { target: { value: companyName } });
  fireEvent.change(screen.getByPlaceholderText(/Nous créons des sites internet/), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  fireEvent.change(screen.getByPlaceholderText("Ex : Création de sites web"), { target: { value: "Site web" } });
  fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
}

describe("ManualEntryFlow", () => {
  it("keeps 'Continuer' disabled on the identity step until both required fields are filled", () => {
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Ex : Fayluméa"), { target: { value: "Fayluméa" } });
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Nous créons des sites internet/), { target: { value: "Nous créons des sites web." } });
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires at least one offer before leaving the offer step", () => {
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Ex : Fayluméa"), { target: { value: "Fayluméa" } });
    fireEvent.change(screen.getByPlaceholderText(/Nous créons des sites internet/), { target: { value: "Nous créons des sites web." } });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Ex : Création de sites web"), { target: { value: "Site web" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides B2B-only target fields when the user selects Particuliers (progressive disclosure)", () => {
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={vi.fn()} />);
    fillIdentityAndOffer();
    fireEvent.click(screen.getByRole("button", { name: "Particuliers" }));
    expect(screen.queryByText(/Quel type d'entreprise ciblez-vous/)).toBeNull();
    expect(screen.queryByText(/Taille de vos clients/)).toBeNull();
    expect(screen.getByText(/Où trouvez-vous principalement vos clients/)).toBeTruthy();
  });

  it("shows B2B target fields when the user selects Entreprises", () => {
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={vi.fn()} />);
    fillIdentityAndOffer();
    fireEvent.click(screen.getByRole("button", { name: "Entreprises" }));
    expect(screen.getByText(/Quel type d'entreprise ciblez-vous/)).toBeTruthy();
    expect(screen.getByText(/Taille de vos clients/)).toBeTruthy();
  });

  it("shows B2B target fields for Les deux too", () => {
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={vi.fn()} />);
    fillIdentityAndOffer();
    fireEvent.click(screen.getByRole("button", { name: "Les deux" }));
    expect(screen.getByText(/Quel type d'entreprise ciblez-vous/)).toBeTruthy();
  });

  it("keeps 'Continuer' disabled on the target step until a customer type is chosen", () => {
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={vi.fn()} />);
    fillIdentityAndOffer();
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Particuliers" }));
    expect((screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reaches the summary and submits with everything else left optional/skipped", () => {
    const onSubmit = vi.fn();
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={onSubmit} />);
    fillIdentityAndOffer("Fayluméa", "Nous créons des sites web et automatisations pour entreprises");
    fireEvent.click(screen.getByRole("button", { name: "Particuliers" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // -> angle
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // -> summary, mainProblem skipped

    expect(screen.getByRole("heading", { name: "Fayluméa" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tout est correct" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0]![0];
    expect(values.companyName).toBe("Fayluméa");
    expect(values.offers).toEqual(["Site web"]);
    expect(values.customerTypeLabel).toBe("Particuliers");
    expect(values.mainProblem).toBe("");
  });

  it("lets 'Modifier' on the summary go back into the flow without losing answers", () => {
    const onSubmit = vi.fn();
    render(<ManualEntryFlow onCancel={vi.fn()} onSubmit={onSubmit} />);
    fillIdentityAndOffer();
    fireEvent.click(screen.getByRole("button", { name: "Les deux" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // -> angle
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // -> summary

    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByPlaceholderText(/Ex : Ils ont du mal/)).toBeTruthy(); // back on the angle step
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onCancel from the first step's left-hand button, not onSubmit", () => {
    const onCancel = vi.fn();
    render(<ManualEntryFlow cancelLabel="Retour" onCancel={onCancel} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retour" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

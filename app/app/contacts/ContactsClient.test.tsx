import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { SandboxProvider } from "../state/SandboxProvider";
import { STORAGE_KEY } from "../state/storage";
import { ContactsClient } from "./ContactsClient";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Contacts mobile detail flow", () => {
  it("opens a selected contact and returns to the contact list", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        sessionActive: true,
        connections: {
          linkedin: { status: "connected" },
          whatsapp: { status: "disconnected" },
          gmail: { status: "disconnected" },
        },
        contacts: [
          {
            id: "contact-1",
            name: "Persona Synthétique",
            email: "persona@example.test",
            phone: "+000 000 000",
            channel: "linkedin",
          },
        ],
        opportunities: [],
        automations: [],
        pipelineView: "pipeline",
      }),
    );

    render(
      <SandboxProvider>
        <ContactsClient />
      </SandboxProvider>,
    );

    const contactName = await screen.findByText("Persona Synthétique");
    const contact = contactName.closest("button");
    expect(contact).not.toBeNull();
    fireEvent.click(contact!);

    const detailHeading = screen.getByRole("heading", {
      level: 1,
      name: "Persona Synthétique",
    });
    const detail = detailHeading.closest(".contact-record");
    expect(detail).not.toBeNull();
    expect(within(detail!).getByText("persona@example.test")).toBeDefined();
    expect(within(detail!).getByText("+000 000 000")).toBeDefined();
    expect(within(detail!).getByText("LinkedIn")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Retour aux contacts" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", {
          level: 1,
          name: "Persona Synthétique",
        }),
      ).toBeNull();
    });
  });
});

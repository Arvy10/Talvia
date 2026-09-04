import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InboxClient, type InboxInitialData } from "./InboxClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const contact = { id: "contact-1", name: "Jane Doe", company: "Acme" };

function baseInitialData(overrides: Partial<InboxInitialData> = {}): InboxInitialData {
  return {
    conversations: [
      {
        id: "conv-1",
        contactId: "contact-1",
        contactName: "Jane Doe",
        company: "Acme",
        channel: "linkedin",
        archived: false,
        unread: false,
        lastMessageAt: "2026-01-01T10:00:00.000Z",
        hasMoreMessages: false,
        messages: [
          { id: "msg-1", body: "Bonjour", direction: "inbound", status: "received", createdAt: "2026-01-01T09:00:00.000Z" },
          { id: "msg-2", body: "Salut, ça va ?", direction: "outbound", status: "read", createdAt: "2026-01-01T10:00:00.000Z" },
        ],
      },
    ],
    contacts: [contact],
    opportunities: [],
    connections: [{ channel_type: "linkedin", status: "connected" }],
    activeConversationId: "conv-1",
    ...overrides,
  };
}

// Every InboxClient test seeds initialData (the SSR path) specifically so
// the first render never depends on a fetch resolving — that's the whole
// point of the blank-page fix, and it also keeps these tests fast/isolated.
describe("InboxClient — first paint", () => {
  it("renders the conversation list and the active conversation's messages with no fetch at all", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<InboxClient initialData={baseInitialData()} />);

    expect(screen.getByText("Bonjour")).toBeInTheDocument();
    // Appears twice: once as the message bubble, once as the thread list's preview line.
    expect(screen.getAllByText("Salut, ça va ?").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
    // The background refresh()/connections calls are intentionally skipped
    // when SSR already provided initialData (see the mount effect).
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("InboxClient — optimistic sending", () => {
  it("shows the message immediately, before the send request resolves", async () => {
    let resolveSend: (value: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/messages") && !String(input).includes("since")) {
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<InboxClient initialData={baseInitialData()} />);
    const textarea = screen.getByPlaceholderText("Écrivez votre message...");
    fireEvent.change(textarea, { target: { value: "Nouveau message" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));

    // Appears immediately — well before the fetch promise ever resolves.
    expect(screen.getAllByText("Nouveau message").length).toBeGreaterThan(0);

    resolveSend(new Response(JSON.stringify({ message: { id: "msg-real-1", body: "Nouveau message", direction: "outbound", status: "sent", createdAt: "2026-01-01T11:00:00.000Z" } }), { status: 201 }));
    await waitFor(() => expect(screen.getByLabelText("Envoyé")).toBeInTheDocument());
  });

  it("shows a retry affordance when the send fails, and clears it on a successful retry", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/messages") && !String(input).includes("since")) {
        callCount += 1;
        if (callCount === 1) return new Response(JSON.stringify({ error: "panne" }), { status: 500 });
        return new Response(JSON.stringify({ message: { id: "msg-real-2", body: "Retenté", direction: "outbound", status: "sent", createdAt: "2026-01-01T11:00:00.000Z" } }), { status: 201 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<InboxClient initialData={baseInitialData()} />);
    fireEvent.change(screen.getByPlaceholderText("Écrivez votre message..."), { target: { value: "Retenté" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));

    const retryButton = await screen.findByRole("button", { name: /échec de l’envoi/i });
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: /échec de l’envoi/i })).not.toBeInTheDocument());
    expect(callCount).toBe(2);
  });

  it("sends on Enter and inserts a newline on Shift+Enter instead", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: { id: "x", body: "a", direction: "outbound", status: "sent", createdAt: "2026-01-01T11:00:00.000Z" } }), { status: 201 }));
    render(<InboxClient initialData={baseInitialData()} />);
    const textarea = screen.getByPlaceholderText("Écrivez votre message...") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Ligne" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "Envoi clavier" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/messages"), expect.objectContaining({ method: "POST" }));
  });
});

describe("InboxClient — conversation cache", () => {
  it("does not refetch a conversation that was already loaded (via SSR) when revisiting it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [], hasMoreMessages: false }), { status: 200 }));
    const initialData = baseInitialData({
      conversations: [
        ...baseInitialData().conversations,
        { id: "conv-2", contactId: "contact-1", contactName: "Jane Doe", channel: "linkedin", archived: false, unread: false, messages: [{ id: "m", body: "preview", direction: "inbound", status: "received", createdAt: "2026-01-01T08:00:00.000Z" }] },
      ],
    });
    render(<InboxClient initialData={initialData} />);

    const secondThread = screen.getAllByText("Jane Doe")[1]!.closest("button")!;
    fireEvent.click(secondThread);
    // conv-2 was never fetched (not in loadedConversationsRef), so opening it does fetch once.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const firstThread = screen.getAllByText("Jane Doe")[0]!.closest("button")!;
    fireEvent.click(firstThread);
    // conv-1 was preloaded via initialData — switching back must not refetch it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("InboxClient — media and links", () => {
  it("renders an image, an audio player with its duration, and a downloadable file", () => {
    const initialData = baseInitialData({
      conversations: [{
        ...baseInitialData().conversations[0]!,
        messages: [
          { id: "msg-img", body: "", direction: "inbound", status: "received", createdAt: "2026-01-01T09:00:00.000Z", attachments: [{ id: "att-1", type: "img", width: 10, height: 10 }] },
          { id: "msg-audio", body: "", direction: "inbound", status: "received", createdAt: "2026-01-01T09:05:00.000Z", attachments: [{ id: "att-2", type: "audio", duration: 32, voiceNote: true }] },
          { id: "msg-file", body: "", direction: "inbound", status: "received", createdAt: "2026-01-01T09:10:00.000Z", attachments: [{ id: "att-3", type: "file", fileName: "brief.pdf", fileSize: 2048 }] },
        ],
      }],
    });
    render(<InboxClient initialData={initialData} />);

    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/inbox/attachments/msg-img/att-1");
    expect(screen.getByText(/0:32/)).toBeInTheDocument();
    const fileLink = screen.getByText("brief.pdf").closest("a")!;
    expect(fileLink).toHaveAttribute("href", "/api/inbox/attachments/msg-file/att-3");
    expect(fileLink).toHaveAttribute("download");
  });

  it("turns a URL inside message text into a real link while keeping the surrounding text", () => {
    const initialData = baseInitialData({
      conversations: [{
        ...baseInitialData().conversations[0]!,
        messages: [
          { id: "msg-link", body: "Voici mon site : https://example.com, à bientôt", direction: "inbound", status: "received", createdAt: "2026-01-01T09:00:00.000Z" },
        ],
      }],
    });
    render(<InboxClient initialData={initialData} />);

    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(link.parentElement!).getByText(/Voici mon site/)).toBeInTheDocument();
    expect(within(link.parentElement!).getByText(/à bientôt/)).toBeInTheDocument();
  });
});

// UX pass: profile on demand, a real way out of a conversation, per-Inbox
// appearance, and mark-as-read wired to the persisted read model.
describe("InboxClient — conversation and profile controls", () => {
  it("does not open the contact panel by default", () => {
    render(<InboxClient initialData={baseInitialData()} />);

    const layout = document.querySelector(".talvia-inbox-layout")!;
    expect(layout).toHaveAttribute("data-context", "closed");
  });

  it("opens the contact panel from the header and closes it again", () => {
    render(<InboxClient initialData={baseInitialData()} />);
    const layout = document.querySelector(".talvia-inbox-layout")!;

    fireEvent.click(screen.getByTitle("Informations du contact"));
    expect(layout).toHaveAttribute("data-context", "open");

    fireEvent.click(screen.getByTitle("Fermer"));
    expect(layout).toHaveAttribute("data-context", "closed");
  });

  it("opens the contact panel by clicking the contact identity in the header", () => {
    render(<InboxClient initialData={baseInitialData()} />);

    fireEvent.click(screen.getByTitle("Voir le contact"));

    expect(document.querySelector(".talvia-inbox-layout")).toHaveAttribute("data-context", "open");
  });

  it("closes the conversation entirely — no previous thread stays rendered", () => {
    render(<InboxClient initialData={baseInitialData()} />);
    expect(screen.getByText("Bonjour")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Fermer la conversation"));

    // The message body is gone (the thread list preview keeps its own copy).
    expect(screen.queryByText("Bonjour")).not.toBeInTheDocument();
    expect(screen.getByText("Sélectionnez une conversation")).toBeInTheDocument();
  });

  it("re-opens a conversation after closing it", () => {
    render(<InboxClient initialData={baseInitialData()} />);
    fireEvent.click(screen.getByTitle("Fermer la conversation"));
    expect(screen.getByText("Sélectionnez une conversation")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Jane Doe")[0]!);

    expect(screen.getByText("Bonjour")).toBeInTheDocument();
  });

  it("toggles the Inbox appearance without touching anything outside the Inbox", () => {
    render(<InboxClient initialData={baseInitialData()} />);
    const layout = document.querySelector(".talvia-inbox-layout")!;
    expect(layout).toHaveAttribute("data-inbox-theme", "dark");

    fireEvent.click(screen.getByTitle("Apparence claire"));

    expect(layout).toHaveAttribute("data-inbox-theme", "light");
    // Scoped: the preference lives on the Inbox root only.
    expect(document.documentElement).not.toHaveAttribute("data-inbox-theme");
    expect(window.localStorage.getItem("talvia.inbox.theme")).toBe("light");
  });
});

describe("InboxClient — mark as read (persisted model)", () => {
  it("marks one conversation as read through the real read endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ conversation: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const data = baseInitialData();
    data.conversations[0]!.unread = true;
    render(<InboxClient initialData={data} />);

    fireEvent.click(screen.getByTitle("Marquer comme lu"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inbox/conversations/conv-1/read",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("offers 'tout marquer comme lu' only when something is unread", () => {
    render(<InboxClient initialData={baseInitialData()} />);
    expect(screen.queryByText("Tout marquer comme lu")).not.toBeInTheDocument();

    cleanup();
    const data = baseInitialData();
    data.conversations[0]!.unread = true;
    render(<InboxClient initialData={data} />);
    expect(screen.getByText("Tout marquer comme lu")).toBeInTheDocument();
  });
});

describe("InboxClient — channel presentation", () => {
  it("shows the subject in the header for an email conversation and uses the editorial message style", () => {
    const data = baseInitialData();
    data.conversations[0]!.channel = "email";
    data.conversations[0]!.subject = "Votre devis";
    data.connections = [{ channel_type: "email", status: "connected" }];
    render(<InboxClient initialData={data} />);

    expect(screen.getByText("Votre devis")).toBeInTheDocument();
    expect(document.querySelectorAll(".inbox-message--email").length).toBeGreaterThan(0);
  });

  it("keeps WhatsApp and LinkedIn conversational — no email modifier", () => {
    const data = baseInitialData();
    data.conversations[0]!.channel = "whatsapp";
    data.connections = [{ channel_type: "whatsapp", status: "connected" }];
    render(<InboxClient initialData={data} />);

    expect(document.querySelectorAll(".inbox-message--email")).toHaveLength(0);
    expect(document.querySelectorAll(".inbox-message").length).toBeGreaterThan(0);
  });
});

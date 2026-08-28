"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuBot,
  LuEllipsis,
  LuInbox,
  LuMessageCircle,
  LuPlus,
  LuSearch,
  LuUserRound,
} from "react-icons/lu";
import SendIcon from "../components/icons/SendIcon";
import SparklesIcon from "../components/icons/SparklesIcon";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import type { ChannelId, Contact, Opportunity } from "../state/types";
import { apiChannelToUi, channelMap, uiChannelToApi } from "./inbox-model";
import { generateReply, type ReplyMode } from "./talvia-ai";

type ApiConnection = { channel_type: "linkedin" | "whatsapp" | "email"; status: string };

type ApiMessage = {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  status: string;
  createdAt: string;
};
type ApiConversation = {
  id: string;
  contactId?: string;
  contactName?: string;
  company?: string;
  channel: "linkedin" | "whatsapp" | "email";
  subject?: string;
  archived: boolean;
  unread: boolean;
  lastMessageAt?: string;
  messages: ApiMessage[];
};
type Thread = ApiConversation & { key: string; latest?: ApiMessage };

export function InboxClient() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState<ChannelId | "">("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<ChannelId | "all">("all");
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat" | "context">(
    "list",
  );
  const [error, setError] = useState("");
  const [connectedChannels, setConnectedChannels] = useState<Set<ChannelId> | null>(null);
  const refresh = async (archived = false) => {
    const [a, b, c] = await Promise.all([
      fetch(`/api/inbox/conversations?archived=${archived}`),
      fetch("/api/contacts"),
      fetch("/api/opportunities"),
    ]);
    if (!a.ok || !b.ok || !c.ok) {
      setError("Impossible de charger l’Inbox.");
      return;
    }
    setConversations(
      ((await a.json()) as { conversations: ApiConversation[] }).conversations,
    );
    setContacts(((await b.json()) as { contacts: Contact[] }).contacts);
    setOpportunities(((await c.json()) as { opportunities: Opportunity[] }).opportunities);
  };
  useEffect(() => {
    void refresh();
    void fetch("/api/connections").then((response) => (response.ok ? response.json() : null)).then((data: { connections: ApiConnection[] } | null) => {
      const connected = (data?.connections ?? []).filter((item) => item.status === "connected").map((item) => apiChannelToUi(item.channel_type));
      setConnectedChannels(new Set(connected));
    });
  }, []);

  const threads = useMemo(
    () =>
      conversations
        .map((conversation): Thread => ({
          ...conversation,
          key: conversation.id,
          latest: [...conversation.messages]
            .filter((m) => m.status !== "draft")
            .at(-1),
        }))
        .filter(
          (thread) =>
          (filter === "all" || apiChannelToUi(thread.channel) === filter) &&
            (!search ||
              `${thread.contactName ?? ""} ${thread.company ?? ""} ${thread.latest?.body ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase())),
        ),
    [conversations, filter, search],
  );
  const activeThread =
    threads.find((thread) => thread.id === activeKey) ?? threads[0] ?? null;
  const threadMessages = activeThread?.messages ?? [];
  const activeContact = contacts.find(
    (contact) => contact.id === activeThread?.contactId,
  );

  // The list endpoint only carries each conversation's latest message (for
  // the preview line); the full history is fetched here once a thread is
  // actually open, so the list stays cheap regardless of conversation length.
  const loadThreadMessages = async (conversationId: string) => {
    const response = await fetch(`/api/inbox/conversations/${conversationId}`);
    if (!response.ok) return;
    const data = (await response.json()) as { conversation?: ApiConversation };
    if (!data.conversation) return;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, messages: data.conversation!.messages }
          : conversation,
      ),
    );
  };
  useEffect(() => {
    if (activeThread) void loadThreadMessages(activeThread.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id]);
  // A conversation can only start on a channel Talvia is actually connected
  // to — otherwise nothing would ever be sent, even though the contact
  // happens to have a phone number or email on file.
  const availableChannels = (contacts.find((contact) => contact.id === contactId)
    ? getContactChannels(contacts.find((contact) => contact.id === contactId)!)
    : []
  ).filter((item) => connectedChannels?.has(item));
  const opportunity = opportunities.find(
    (item) => item.contactId === activeContact?.id,
  );

  const beginConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!contactId || !channel) {
      setError("Choisissez un contact et l’un de ses canaux disponibles.");
      return;
    }
    const response = await fetch("/api/inbox/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactIds: [contactId],
        channel: uiChannelToApi(channel),
      }),
    });
    const data = (await response.json()) as {
      conversation?: ApiConversation;
      error?: string;
    };
    if (!response.ok || !data.conversation) {
      setError(data.error ?? "Création impossible.");
      return;
    }
    setActiveKey(data.conversation.id);
    setNewOpen(false);
    setContactId("");
    setChannel("");
    setMobileView("chat");
    await refresh();
  };
  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeThread || !draft.trim()) return;
    const response = await fetch(
      `/api/inbox/conversations/${activeThread.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      },
    );
    if (!response.ok) {
      setError("Impossible d’enregistrer le brouillon.");
      return;
    }
    setDraft("");
    setAiOpen(false);
    await refresh();
    await loadThreadMessages(activeThread.id);
  };
  const useAi = (mode: ReplyMode) => {
    setDraft(
      generateReply(
        {
          conversation: threadMessages.map((message) => ({
            ...message,
            createdAt: message.createdAt,
            simulated: true,
            contactId: activeThread?.contactId ?? "",
            channel: activeThread ? apiChannelToUi(activeThread.channel) : "gmail",
          })),
          contact: activeContact,
          opportunity,
          currentDraft: draft,
        },
        mode,
      ),
    );
    setAiOpen(false);
  };
  const saveNote = (_value: string) => undefined;
  const createOpportunity = () => {
    if (!activeContact || !activeThread) return;
    router.push(
      `/app/opportunities?contactId=${encodeURIComponent(activeContact.id)}&conversationId=${encodeURIComponent(activeThread.id)}`,
    );
  };

  if (connectedChannels && connectedChannels.size === 0) {
    return (
      <div className="inbox-page inbox-page--center">
        <div className="inbox-no-channels">
          <h1>Boîte de réception.</h1>
          <p>Connectez un canal pour voir vos conversations ici.</p>
          <ul>
            <li>Gérez vos e-mails Gmail directement depuis Talvia</li>
            <li>Envoyez et recevez des messages LinkedIn et WhatsApp</li>
            <li>Retrouvez le contexte de chaque contact à côté de la conversation</li>
          </ul>
          <div className="inbox-no-channels__brands">
            <span>Fonctionne avec</span>
            {channelMap.map((item) => <ChannelLogo channel={item.id} key={item.id} />)}
          </div>
          <Link className="connection-button" href="/app/connections">Connecter un canal<LuArrowRight aria-hidden="true" /></Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`inbox-page inbox-page--center mobile-view-${mobileView}`}>
      <header className="inbox-compact-header">
        <div>
          <h1>Inbox</h1>
          <p>
            Retrouvez le contexte, le contact et la prochaine action derrière chaque conversation.
          </p>
        </div>
        <button
          className="connection-button"
          onClick={() => setNewOpen(true)}
          type="button"
        >
          <LuPlus />
          Nouvelle conversation
        </button>
      </header>
      <section className="talvia-inbox-layout">
        <aside className="talvia-inbox-list">
          <div className="inbox-list-heading">
            <strong>Conversations</strong>
            <span>{threads.length}</span>
          </div>
          <label className="inbox-dense-search">
            <LuSearch />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher..."
              value={search}
            />
          </label>
          <div className="inbox-brand-filters">
            <button
              className={filter === "all" ? "is-active" : undefined}
              onClick={() => setFilter("all")}
              type="button"
            >
              Toutes
            </button>
            {channelMap.map((item) => (
              <button
                aria-label={item.label}
                className={filter === item.id ? "is-active" : undefined}
                key={item.id}
                onClick={() => setFilter(item.id)}
                title={item.label}
                type="button"
              >
                <ChannelLogo channel={item.id} />
              </button>
            ))}
          </div>
          {threads.length === 0 ? (
            <EmptyState
              className="inbox-dense-empty"
              icon={<LuInbox />}
              title="Aucune conversation pour le moment"
              description="Démarrez une conversation avec un contact ou retrouvez ici les réponses issues de votre suivi commercial."
              action={
                <button
                  className="connection-button connection-button--secondary"
                  onClick={() => setNewOpen(true)}
                  type="button"
                >
                  Nouvelle conversation
                </button>
              }
            />
          ) : (
            <div className="inbox-dense-threads">
              {threads.map((thread) => {
                const contact = contacts.find(
                  (item) => item.id === thread.contactId,
                );
                return (
                  <button
                    className={
                      activeThread?.key === thread.key
                        ? "inbox-dense-thread is-active"
                        : "inbox-dense-thread"
                    }
                    key={thread.key}
                    onClick={() => {
                      setActiveKey(thread.key);
                      setMobileView("chat");
                    }}
                    type="button"
                  >
                    <span className="inbox-avatar">
                      {contact?.name.slice(0, 2).toUpperCase() ?? "?"}
                    </span>
                    <span>
                      <strong>{contact?.name ?? "Contact"}</strong>
                      <small>
                        {contact?.company ??
                          channelMap.find((item) => item.id === thread.channel)
                            ?.label}
                      </small>
                      <p>
                        {thread.latest?.body ?? "Aucun message pour le moment"}
                      </p>
                    </span>
                    <span className="inbox-thread-meta">
                      <ChannelLogo channel={apiChannelToUi(thread.channel)} />
                      <time>
                        {thread.latest
                          ? new Date(
                              thread.latest.createdAt,
                            ).toLocaleTimeString("fr", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </time>
                      {thread.latest?.direction === "inbound" ? <i /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
        <section className="talvia-inbox-chat">
          <header className="inbox-chat-heading">
            <button
              className="inbox-mobile-control"
              onClick={() => setMobileView("list")}
              type="button"
            >
              <LuArrowLeft />
            </button>
            {activeContact && activeThread ? (
              <>
                <div className="inbox-chat-person">
                  <span className="inbox-avatar">
                    {activeContact.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{activeContact.name}</strong>
                    <small>
                      <ChannelLogo channel={apiChannelToUi(activeThread.channel)} />
                      {
                        channelMap.find(
                          (item) => item.id === activeThread.channel,
                        )?.label
                      }
                    </small>
                  </span>
                </div>
                <div className="inbox-chat-actions">
                  <button
                    onClick={() => setMobileView("context")}
                    type="button"
                  >
                    <LuUserRound />
                    <span>Contexte</span>
                  </button>
                </div>
              </>
            ) : (
              <strong>Conversation</strong>
            )}
          </header>
          <div className="inbox-message-scroll">
            {!activeThread ? (
              <EmptyState
                icon={<LuMessageCircle />}
                title="Sélectionnez une conversation"
                description="Choisissez un échange ou démarrez une nouvelle conversation."
              />
            ) : threadMessages.length === 0 ? (
              <div className="inbox-conversation-empty">
                <LuMessageCircle />
                <h2>Aucun message pour le moment</h2>
                <p>Commencez la conversation avec ce contact.</p>
              </div>
            ) : (
              threadMessages.map((message) => (
                <div
                  className={`inbox-message inbox-message--${message.direction}`}
                  key={message.id}
                >
                  <p>{message.body}</p>
                  <span>
                    {new Date(message.createdAt).toLocaleTimeString("fr", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
          {activeThread ? (
            <form className="talvia-composer" onSubmit={sendMessage}>
              <textarea
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Écrivez votre message..."
                rows={3}
                value={draft}
              />
              <div className="talvia-composer__bar">
                <div>
                  <button
                    aria-label="Ajouter une pièce jointe prochainement"
                    disabled
                    type="button"
                  >
                    <LuPlus />
                  </button>
                  <button
                    className="talvia-ai-trigger"
                    onClick={() => setAiOpen(!aiOpen)}
                    type="button"
                  >
                    <SparklesIcon aria-hidden="true" size={14} />
                    Générer avec Talvia
                  </button>
                </div>
                <button
                  className="talvia-send-button"
                  disabled={!draft.trim()}
                  type="submit"
                >
                  <SendIcon aria-hidden="true" size={14} />
                  Envoyer
                </button>
              </div>
              {aiOpen ? (
                <div className="talvia-ai-menu">
                  <div>
                    <LuBot />
                    <span>
                      <strong>Talvia peut préparer votre réponse</strong>
                      <small>Fonction IA simulée dans cet environnement.</small>
                    </span>
                  </div>
                  <div>
                    {(
                      [
                        "generate",
                        "shorter",
                        "professional",
                        "natural",
                        "warmer",
                        "direct",
                      ] as ReplyMode[]
                    ).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => useAi(mode)}
                        type="button"
                      >
                        {
                          {
                            generate: "Générer une réponse",
                            shorter: "Plus court",
                            professional: "Plus professionnel",
                            natural: "Plus naturel",
                            warmer: "Plus chaleureux",
                            direct: "Plus direct",
                          }[mode]
                        }
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </form>
          ) : null}
        </section>
        <aside className="talvia-inbox-context">
          <div className="inbox-context-mobile-heading">
            <button onClick={() => setMobileView("chat")} type="button">
              <LuArrowLeft />
              Conversation
            </button>
          </div>
          {activeContact && activeThread ? (
            <>
              <section className="inbox-contact-identity">
                <span className="inbox-avatar inbox-avatar--large">
                  {activeContact.name.slice(0, 2).toUpperCase()}
                </span>
                <h2>{activeContact.name}</h2>
                <p>
                  {activeContact.role ?? "Fonction non renseignée"}
                  {activeContact.company ? ` · ${activeContact.company}` : ""}
                </p>
                <span className="inbox-contact-saved">
                  <LuUserRound />
                  Contact enregistré
                </span>
                <Link href="/app/contacts">Voir le contact</Link>
              </section>
              <section>
                <p className="inbox-context-label">CANAUX</p>
                <div className="inbox-context-channels">
                  {getContactChannels(activeContact).map((item) => (
                    <span key={item}>
                      <ChannelLogo channel={item} />
                      {
                        channelMap.find(
                          (channelItem) => channelItem.id === item,
                        )?.label
                      }
                    </span>
                  ))}
                </div>
              </section>
              <section>
                <p className="inbox-context-label">OPPORTUNITÉ</p>
                {opportunity ? (
                  <div className="inbox-opportunity">
                    <strong>{opportunity.title}</strong>
                    <span>{opportunity.stage}</span>
                    <Link href="/app/opportunities">Voir l’opportunité</Link>
                  </div>
                ) : (
                  <div className="inbox-no-opportunity">
                    <span>Aucune opportunité associée.</span>
                    <button onClick={createOpportunity} type="button">
                      Créer une opportunité
                    </button>
                  </div>
                )}
              </section>
              <section>
                <p className="inbox-context-label">NOTES</p>
                <textarea
                  maxLength={500}
                  onChange={(event) => saveNote(event.target.value)}
                  placeholder="Ajoutez une note commerciale..."
                  rows={6}
                  value={activeContact.notes ?? ""}
                />
              </section>
              <section className="inbox-context-data">
                <p className="inbox-context-label">COORDONNÉES</p>
                {activeThread.channel === "whatsapp" ? (
                  <span>{activeContact.phone ?? "Numéro non renseigné"}</span>
                ) : activeThread.channel === "email" ? (
                  <span>{activeContact.email ?? "Email non renseigné"}</span>
                ) : (
                  <>
                    <span>
                      {activeContact.role ?? "Fonction non renseignée"}
                    </span>
                    <span>
                      {activeContact.company ?? "Entreprise non renseignée"}
                    </span>
                  </>
                )}
              </section>
            </>
          ) : (
            <EmptyState
              icon={<LuUserRound />}
              title="Contexte commercial"
              description="Sélectionnez une conversation pour afficher le contact et les prochaines actions."
            />
          )}
        </aside>
      </section>
      <Dialog
        description="Choisissez uniquement le contact et le canal. Vous écrirez ensuite dans la conversation."
        onClose={() => {
          setNewOpen(false);
          setError("");
        }}
        open={newOpen}
        title="Nouvelle conversation"
      >
        <form className="workspace-form" onSubmit={beginConversation}>
          <label>
            <span>Contact</span>
            <select
              onChange={(event) => {
                setContactId(event.target.value);
                setChannel("");
                setError("");
              }}
              value={contactId}
            >
              <option value="">Choisir un contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          </label>
          {contactId ? (
            <fieldset>
              <legend>Canal disponible</legend>
              {availableChannels.length ? (
                <div className="new-conversation-channels">
                  {availableChannels.map((item) => (
                    <button
                      className={channel === item ? "is-active" : undefined}
                      key={item}
                      onClick={() => setChannel(item)}
                      type="button"
                    >
                      <ChannelLogo channel={item} />
                      {
                        channelMap.find(
                          (channelItem) => channelItem.id === item,
                        )?.label
                      }
                    </button>
                  ))}
                </div>
              ) : (
                <p className="form-hint">
                  Aucun canal disponible pour ce contact.{" "}
                  <Link href="/app/contacts">Modifier le contact</Link>
                </p>
              )}
            </fieldset>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="workspace-form__actions">
            <button
              className="connection-button connection-button--secondary"
              onClick={() => setNewOpen(false)}
              type="button"
            >
              Annuler
            </button>
            <button
              className="connection-button"
              disabled={!contactId || !channel}
              type="submit"
            >
              Commencer la conversation
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function getContactChannels(contact: {
  channel?: ChannelId;
  phone?: string;
  email?: string;
}): ChannelId[] {
  const result = new Set<ChannelId>();
  if (contact.channel) result.add(contact.channel);
  if (contact.phone) result.add("whatsapp");
  if (contact.email) result.add("gmail");
  return [...result];
}

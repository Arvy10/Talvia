"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { LuInbox, LuMessageCircle, LuPanelRight, LuPlus, LuSend } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { EmptyState, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import { useSandbox } from "../state/SandboxProvider";
import type { ChannelId, SandboxMessage } from "../state/types";
import { channelMap } from "./inbox-model";

type Thread = { key: string; contactId: string; channel: ChannelId; latest: SandboxMessage };

export function InboxClient() {
  const { state, dispatch } = useSandbox();
  const messages = state.messages ?? [];
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState<ChannelId>("linkedin");
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [filter, setFilter] = useState<ChannelId | "all">("all");
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const threads = useMemo(() => {
    const result = new Map<string, Thread>();
    messages.forEach((message) => {
      if (filter !== "all" && message.channel !== filter) return;
      const key = `${message.contactId}:${message.channel}`;
      const existing = result.get(key);
      if (!existing || existing.latest.createdAt < message.createdAt) result.set(key, { key, contactId: message.contactId, channel: message.channel, latest: message });
    });
    return [...result.values()].sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
  }, [filter, messages]);
  const activeThread = threads.find((thread) => thread.key === activeThreadKey) ?? threads[0] ?? null;
  const threadMessages = activeThread ? messages.filter((message) => message.contactId === activeThread.contactId && message.channel === activeThread.channel) : [];
  const activeContact = state.contacts.find((contact) => contact.id === activeThread?.contactId);

  const closeComposer = () => { setComposerOpen(false); setContactId(""); setBody(""); setError(""); };
  const createMessage = (message: SandboxMessage, label: string) => { dispatch({ type: "CREATE_MESSAGE", message }); dispatch({ type: "ADD_ACTIVITY", activity: { id: crypto.randomUUID(), label, createdAt: message.createdAt } }); };
  const sendConversation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactId) { setError("Choisissez un contact avant d’envoyer le message."); return; }
    if (!body.trim()) { setError("Écrivez un message avant de l’envoyer."); return; }
    const now = new Date().toISOString();
    createMessage({ id: crypto.randomUUID(), contactId, channel, body: body.trim(), direction: "outbound", simulated: true, createdAt: now }, "Message envoyé");
    setActiveThreadKey(`${contactId}:${channel}`); closeComposer();
  };
  const sendReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeThread || !replyBody.trim()) return;
    const now = new Date().toISOString();
    createMessage({ id: crypto.randomUUID(), contactId: activeThread.contactId, channel: activeThread.channel, body: replyBody.trim(), direction: "inbound", simulated: true, createdAt: now }, "Réponse reçue");
    setReplyBody(""); setReplyOpen(false);
  };

  return <div className="inbox-page">
    <PageHeader eyebrow="Messages" title="Inbox" description="Retrouvez chaque échange et testez le parcours commercial de bout en bout." actions={<button className="connection-button" onClick={() => setComposerOpen(true)} type="button"><LuPlus />Nouvelle conversation</button>} />
    <section aria-label="Espace de conversations" className="inbox-workspace">
      <aside className="inbox-list-panel"><header className="inbox-list-panel__header"><div><p>CONVERSATIONS</p><h2>{threads.length ? `${threads.length} conversation${threads.length > 1 ? "s" : ""}` : "Tout est calme"}</h2></div></header><div className="inbox-channel-filters"><button className={filter === "all" ? "is-active" : undefined} onClick={() => setFilter("all")} type="button"><LuInbox /><span>Toutes</span></button>{channelMap.map(({ id, label }) => <button className={filter === id ? "is-active" : undefined} key={id} onClick={() => setFilter(id)} type="button"><ChannelLogo channel={id} /><span>{label}</span></button>)}</div>{threads.length === 0 ? <EmptyState className="inbox-list-empty" icon={<LuInbox />} title="Aucune conversation" description="Créez une conversation pour commencer un échange." action={<button className="connection-button connection-button--secondary" onClick={() => setComposerOpen(true)} type="button">Créer une conversation</button>} /> : <div className="inbox-message-list">{threads.map((thread) => <button aria-pressed={activeThread?.key === thread.key} className={activeThread?.key === thread.key ? "inbox-message-preview is-active" : "inbox-message-preview"} key={thread.key} onClick={() => setActiveThreadKey(thread.key)} type="button"><ChannelLogo channel={thread.channel} /><div><strong>{state.contacts.find((contact) => contact.id === thread.contactId)?.name ?? "Contact"}</strong><p>{thread.latest.body}</p><small>{thread.latest.direction === "inbound" ? "À traiter" : "Envoyé"}</small></div></button>)}</div>}</aside>
      <section className="inbox-conversation-canvas">{activeThread === null ? <EmptyState icon={<LuMessageCircle />} title="Sélectionnez une conversation" description="Vos échanges apparaîtront ici dès leur envoi." /> : <div className="inbox-thread"><div className="inbox-thread__heading"><div><p>{channelMap.find((item) => item.id === activeThread.channel)?.label}</p><h2>{activeContact?.name ?? "Contact"}</h2></div><button className="connection-button connection-button--secondary" onClick={() => setReplyOpen(true)} type="button"><LuSend />Simuler une réponse</button></div>{threadMessages.map((message) => <div className={`inbox-bubble inbox-bubble--${message.direction}`} key={message.id}><p>{message.body}</p><small>{message.direction === "inbound" ? "Reçu" : "Envoyé"} · Simulé</small></div>)}</div>}</section>
      <aside className="inbox-context-panel">{activeContact ? <><div className="inbox-context-panel__heading"><LuPanelRight /><div><p>CONTACT</p><h2>{activeContact.name}</h2></div></div><p>{activeContact.company ?? "Entreprise non renseignée"}</p><p>{activeContact.email ?? activeContact.phone ?? "Coordonnées non renseignées"}</p></> : <><div className="inbox-context-panel__heading"><LuPanelRight /><div><p>CONTEXTE</p><h2>Aucun contact</h2></div></div><p>Les informations du contact apparaîtront ici.</p></>}</aside>
    </section>
    <Dialog description="Choisissez un contact, un canal, puis écrivez le premier message." onClose={closeComposer} open={composerOpen} title="Nouvelle conversation"><form className="workspace-form" onSubmit={sendConversation}><label><span>Contact</span><select aria-invalid={Boolean(error && !contactId)} onChange={(event) => { setContactId(event.target.value); setError(""); }} value={contactId}><option value="">Choisir un contact</option>{state.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>{state.contacts.length === 0 ? <p className="form-hint">Ajoutez d’abord un contact dans <Link href="/app/contacts">Contacts</Link>.</p> : null}<label><span>Canal</span><select onChange={(event) => setChannel(event.target.value as ChannelId)} value={channel}>{channelMap.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label><label><span>Message</span><textarea aria-invalid={Boolean(error && !body.trim())} onChange={(event) => { setBody(event.target.value); setError(""); }} placeholder="Bonjour, ..." rows={4} value={body} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={closeComposer} type="button">Annuler</button><button className="connection-button" type="submit">Envoyer</button></div></form></Dialog>
    <Dialog description="Écrivez le message entrant que vous souhaitez tester." onClose={() => { setReplyOpen(false); setReplyBody(""); }} open={replyOpen} title="Simuler une réponse"><form className="workspace-form" onSubmit={sendReply}><label><span>Réponse de {activeContact?.name ?? "ce contact"}</span><textarea autoFocus onChange={(event) => setReplyBody(event.target.value)} placeholder="Bonjour, oui ça m’intéresse." rows={4} value={replyBody} /></label><div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={() => setReplyOpen(false)} type="button">Annuler</button><button className="connection-button" disabled={!replyBody.trim()} type="submit">Ajouter la réponse</button></div></form></Dialog>
  </div>;
}

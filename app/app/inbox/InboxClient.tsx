"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { LuFlame, LuInbox, LuMessageCircle, LuPlus, LuSearch, LuSend, LuSnowflake, LuSunMedium, LuUserRound } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import { useSandbox } from "../state/SandboxProvider";
import type { ChannelId, SandboxMessage } from "../state/types";
import { channelMap } from "./inbox-model";

type Thread = { key: string; contactId: string; channel: ChannelId; latest: SandboxMessage };
const channelTitles: Record<ChannelId, string> = { linkedin: "Messagerie LinkedIn", whatsapp: "Messagerie WhatsApp", gmail: "Messagerie Email" };

export function InboxClient() {
  const { state, dispatch } = useSandbox();
  const messages = state.messages ?? [];
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState<ChannelId>("linkedin");
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [inlineBody, setInlineBody] = useState("");
  const [filter, setFilter] = useState<ChannelId | "all">("all");
  const [search, setSearch] = useState("");
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [temperature, setTemperature] = useState<"hot" | "warm" | "cold">("warm");
  const [note, setNote] = useState("");

  const threads = useMemo(() => {
    const result = new Map<string, Thread>();
    messages.forEach((message) => {
      const contact = state.contacts.find((item) => item.id === message.contactId);
      if (filter !== "all" && message.channel !== filter) return;
      if (search && !`${contact?.name ?? ""} ${message.body}`.toLowerCase().includes(search.toLowerCase())) return;
      const key = `${message.contactId}:${message.channel}`;
      const existing = result.get(key);
      if (!existing || existing.latest.createdAt < message.createdAt) result.set(key, { key, contactId: message.contactId, channel: message.channel, latest: message });
    });
    return [...result.values()].sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
  }, [filter, messages, search, state.contacts]);
  const activeThread = threads.find((thread) => thread.key === activeThreadKey) ?? threads[0] ?? null;
  const threadMessages = activeThread ? messages.filter((message) => message.contactId === activeThread.contactId && message.channel === activeThread.channel) : [];
  const activeContact = state.contacts.find((contact) => contact.id === activeThread?.contactId);
  const title = activeThread ? channelTitles[activeThread.channel] : filter === "all" ? "Messagerie Talvia" : channelTitles[filter];

  const closeComposer = () => { setComposerOpen(false); setContactId(""); setBody(""); setError(""); };
  const createMessage = (message: SandboxMessage, label: string) => { dispatch({ type: "CREATE_MESSAGE", message }); dispatch({ type: "ADD_ACTIVITY", activity: { id: crypto.randomUUID(), label, createdAt: message.createdAt } }); };
  const sendConversation = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!contactId) { setError("Choisissez un contact."); return; } if (!body.trim()) { setError("Écrivez un message."); return; } const now = new Date().toISOString(); createMessage({ id: crypto.randomUUID(), contactId, channel, body: body.trim(), direction: "outbound", simulated: true, createdAt: now }, "Message envoyé"); setActiveThreadKey(`${contactId}:${channel}`); closeComposer(); };
  const sendInline = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!activeThread || !inlineBody.trim()) return; const now = new Date().toISOString(); createMessage({ id: crypto.randomUUID(), contactId: activeThread.contactId, channel: activeThread.channel, body: inlineBody.trim(), direction: "outbound", simulated: true, createdAt: now }, "Message envoyé"); setInlineBody(""); };
  const sendReply = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!activeThread || !replyBody.trim()) return; const now = new Date().toISOString(); createMessage({ id: crypto.randomUUID(), contactId: activeThread.contactId, channel: activeThread.channel, body: replyBody.trim(), direction: "inbound", simulated: true, createdAt: now }, "Réponse reçue"); setReplyBody(""); setReplyOpen(false); };

  return <div className="inbox-page inbox-page--messenger">
    <header className="messenger-hero"><div><div className="messenger-title"><span className="messenger-title__logo">{activeThread ? <ChannelLogo channel={activeThread.channel} /> : <LuInbox />}</span><div><h1>{title}</h1><p>Vos conversations commerciales, réunies dans un même espace.</p></div></div><label className="messenger-global-search"><LuSearch /><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher dans les messages..." value={search} /></label></div><button className="connection-button" onClick={() => setComposerOpen(true)} type="button"><LuPlus />Nouvelle conversation</button></header>
    <section className="messenger-layout">
      <aside className="messenger-conversations"><div className="messenger-panel-title"><strong>Conversations</strong><span>{threads.length}</span></div><label className="messenger-list-search"><LuSearch /><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un contact..." value={search} /></label><div className="messenger-filters"><button className={filter === "all" ? "is-active" : undefined} onClick={() => setFilter("all")} type="button">Toutes</button>{channelMap.map(({ id, label }) => <button className={filter === id ? "is-active" : undefined} key={id} onClick={() => setFilter(id)} type="button">{label}</button>)}</div>{threads.length === 0 ? <EmptyState className="messenger-empty" icon={<LuMessageCircle />} title="Aucune conversation" description="Commencez un nouvel échange pour le retrouver ici." action={<button className="connection-button connection-button--secondary" onClick={() => setComposerOpen(true)} type="button">Nouveau message</button>} /> : <div className="messenger-thread-list">{threads.map((thread) => { const contact = state.contacts.find((item) => item.id === thread.contactId); return <button aria-pressed={activeThread?.key === thread.key} className={activeThread?.key === thread.key ? "messenger-thread-card is-active" : "messenger-thread-card"} key={thread.key} onClick={() => setActiveThreadKey(thread.key)} type="button"><span className="messenger-avatar">{contact?.name.slice(0, 2).toUpperCase() ?? "?"}</span><div><strong>{contact?.name ?? "Contact"}</strong><p>{thread.latest.body}</p><small>{new Date(thread.latest.createdAt).toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })}</small></div><ChannelLogo channel={thread.channel} /></button>; })}</div>}</aside>
      <section className="messenger-chat"><header className="messenger-chat__header">{activeThread ? <><div className="messenger-person"><span className="messenger-avatar">{activeContact?.name.slice(0, 2).toUpperCase() ?? "?"}</span><div><strong>{activeContact?.name ?? "Contact"}</strong><small><span /> Conversation active</small></div></div><button className="connection-button connection-button--quiet" onClick={() => setReplyOpen(true)} type="button">Simuler une réponse</button></> : <strong>Conversation</strong>}</header><div className="messenger-chat__messages">{activeThread === null ? <EmptyState icon={<LuMessageCircle />} title="Ouvrez une conversation" description="Sélectionnez un contact à gauche ou créez un nouvel échange." /> : threadMessages.map((message) => <div className={`messenger-bubble messenger-bubble--${message.direction}`} key={message.id}><span>{message.direction === "inbound" ? activeContact?.name : "Vous"}</span><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })} · Simulé</small></div>)}</div>{activeThread ? <form className="messenger-composer" onSubmit={sendInline}><textarea aria-label="Écrire une réponse" onChange={(event) => setInlineBody(event.target.value)} placeholder={`Écrire via ${channelMap.find((item) => item.id === activeThread.channel)?.label}...`} rows={2} value={inlineBody} /><button aria-label="Envoyer le message" disabled={!inlineBody.trim()} type="submit"><LuSend /></button></form> : null}</section>
      <aside className="messenger-profile">{activeContact ? <><div className="messenger-profile__identity"><span className="messenger-avatar messenger-avatar--large">{activeContact.name.slice(0, 2).toUpperCase()}</span><h2>{activeContact.name}</h2><p>{activeContact.role ?? "Contact commercial"}{activeContact.company ? ` · ${activeContact.company}` : ""}</p><Link href="/app/contacts"><LuUserRound />Voir le profil</Link></div><section><p className="messenger-label">TEMPÉRATURE</p><div className="messenger-temperature"><button className={temperature === "hot" ? "is-active" : undefined} onClick={() => setTemperature("hot")} type="button"><LuFlame />Chaud</button><button className={temperature === "warm" ? "is-active" : undefined} onClick={() => setTemperature("warm")} type="button"><LuSunMedium />Tiède</button><button className={temperature === "cold" ? "is-active" : undefined} onClick={() => setTemperature("cold")} type="button"><LuSnowflake />Froid</button></div></section><section><div className="messenger-note-label"><p className="messenger-label">NOTE</p><span>{note.length}/300</span></div><textarea maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Contexte, relance prévue, objections..." rows={7} value={note} /></section><section className="messenger-contact-data"><p className="messenger-label">COORDONNÉES</p><span>{activeContact.email ?? "Email non renseigné"}</span><span>{activeContact.phone ?? "Téléphone non renseigné"}</span></section></> : <EmptyState icon={<LuUserRound />} title="Profil du contact" description="Les informations apparaîtront avec la conversation." />}</aside>
    </section>
    <Dialog description="Choisissez un contact, un canal, puis écrivez le premier message." onClose={closeComposer} open={composerOpen} title="Nouvelle conversation"><form className="workspace-form" onSubmit={sendConversation}><label><span>Contact</span><select onChange={(event) => { setContactId(event.target.value); setError(""); }} value={contactId}><option value="">Choisir un contact</option>{state.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>{state.contacts.length === 0 ? <p className="form-hint">Ajoutez d’abord un contact dans <Link href="/app/contacts">Contacts</Link>.</p> : null}<label><span>Canal</span><select onChange={(event) => setChannel(event.target.value as ChannelId)} value={channel}>{channelMap.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label><label><span>Message</span><textarea onChange={(event) => { setBody(event.target.value); setError(""); }} placeholder="Bonjour, ..." rows={4} value={body} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={closeComposer} type="button">Annuler</button><button className="connection-button" type="submit">Envoyer</button></div></form></Dialog>
    <Dialog description="Écrivez le message entrant que vous souhaitez tester." onClose={() => { setReplyOpen(false); setReplyBody(""); }} open={replyOpen} title="Simuler une réponse"><form className="workspace-form" onSubmit={sendReply}><label><span>Réponse de {activeContact?.name ?? "ce contact"}</span><textarea autoFocus onChange={(event) => setReplyBody(event.target.value)} placeholder="Bonjour, oui ça m’intéresse." rows={4} value={replyBody} /></label><div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={() => setReplyOpen(false)} type="button">Annuler</button><button className="connection-button" disabled={!replyBody.trim()} type="submit">Ajouter la réponse</button></div></form></Dialog>
  </div>;
}

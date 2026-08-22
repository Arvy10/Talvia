"use client";

import { useState, type FormEvent } from "react";
import { LuPanelRight, LuPlus, LuSearch, LuUserRound, LuUsers } from "react-icons/lu";

import { Dialog } from "../components/Dialog";
import { EmptyState, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import { useSandbox } from "../state/SandboxProvider";
import type { ChannelId } from "../state/types";

const channels: Array<{ id: ChannelId; label: string }> = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "gmail", label: "Gmail" },
];

export function ContactsClient() {
  const { dispatch, state } = useSandbox();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<ChannelId | "">("");
  const [nameError, setNameError] = useState("");
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelId | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setDisplayName("");
    setEmail("");
    setPhone("");
    setChannel("");
    setNameError("");
  };

  const submitContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = displayName.trim();

    if (!trimmedName) {
      setNameError("Saisissez un nom d’affichage pour créer le contact.");
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const contact = {
      id: crypto.randomUUID(),
      name: trimmedName,
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      ...(trimmedPhone ? { phone: trimmedPhone } : {}),
      ...(channel ? { channel } : {}),
    };
    dispatch({ type: "CREATE_CONTACT", contact });
    setSelectedContactId(contact.id);
    closeDialog();
  };

  const visibleContacts = state.contacts.filter((contact) => {
    const name = typeof contact.name === "string" ? contact.name : "";
    const matchesSearch = name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesChannel = channelFilter === null || contact.channel === channelFilter;
    return matchesSearch && matchesChannel;
  });
  const selectedContact = state.contacts.find((contact) => contact.id === selectedContactId) ?? null;

  return <div className="contacts-page">
    <PageHeader
      eyebrow="Répertoire"
      title="Contacts"
      description="Votre répertoire reste vide jusqu’à ce que vous y ajoutiez un contact réel à tester."
      actions={<button className="connection-button" onClick={() => setIsDialogOpen(true)} type="button"><LuPlus aria-hidden="true" />Nouveau contact</button>}
    />

    <section aria-label="Répertoire de contacts" className="contacts-workspace">
      <aside className="contacts-list-panel">
        <label className="inbox-search"><LuSearch aria-hidden="true" /><span className="sr-only">Rechercher des contacts</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un contact" type="search" value={search} /></label>
        <div aria-label="Filtrer par canal" className="contacts-channel-filters">
          {channels.map(({ id, label }) => <button aria-pressed={channelFilter === id} className={channelFilter === id ? "is-active" : undefined} key={id} onClick={() => setChannelFilter(channelFilter === id ? null : id)} type="button"><ChannelLogo channel={id} /><span>{label}</span></button>)}
        </div>
        {visibleContacts.length === 0 ? <EmptyState
          className="contacts-list-empty"
          icon={<LuUsers />}
          title="Aucun contact"
          description={search || channelFilter ? "Aucun contact créé ne correspond à ce filtre." : "Les contacts que vous créerez apparaîtront ici."}
        /> : <div className="contacts-list">
          {visibleContacts.map((contact) => <button aria-pressed={selectedContactId === contact.id} className={selectedContactId === contact.id ? "is-active" : undefined} key={contact.id} onClick={() => setSelectedContactId(contact.id)} type="button"><LuUserRound aria-hidden="true" /><span>{typeof contact.name === "string" ? contact.name : "Contact sans nom"}</span></button>)}
        </div>}
      </aside>

      <section className="contacts-detail-panel">
        {selectedContact === null ? <EmptyState
          icon={<LuPanelRight />}
          title="Sélectionnez un contact"
          description="Les détails d’un contact que vous aurez créé s’afficheront ici."
        /> : <article className="contact-detail">
          <p>CONTACT</p>
          <h2>{typeof selectedContact.name === "string" ? selectedContact.name : "Contact sans nom"}</h2>
          {typeof selectedContact.email === "string" ? <span>{selectedContact.email}</span> : null}
          {typeof selectedContact.phone === "string" ? <span>{selectedContact.phone}</span> : null}
          {typeof selectedContact.channel === "string" ? <span>{channels.find(({ id }) => id === selectedContact.channel)?.label}</span> : null}
        </article>}
      </section>
    </section>

    <Dialog
      description="Les informations restent dans votre bac à sable tant que vous ne les réinitialisez pas."
      onClose={closeDialog}
      open={isDialogOpen}
      title="Nouveau contact"
    >
      <form className="workspace-form" onSubmit={submitContact}>
        <label>
          <span>Nom d’affichage <em aria-hidden="true">*</em></span>
          <input aria-describedby={nameError ? "contact-name-error" : undefined} autoFocus onChange={(event) => { setDisplayName(event.target.value); setNameError(""); }} value={displayName} />
          {nameError ? <small id="contact-name-error" role="alert">{nameError}</small> : null}
        </label>
        <label>
          <span>Email <i>(facultatif)</i></span>
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label>
          <span>Téléphone <i>(facultatif)</i></span>
          <input onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
        </label>
        <label>
          <span>Canal <i>(facultatif)</i></span>
          <select onChange={(event) => setChannel(event.target.value as ChannelId | "")} value={channel}>
            <option value="">Aucun canal</option>
            {channels.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <div className="workspace-form__actions">
          <button className="connection-button connection-button--secondary" onClick={closeDialog} type="button">Annuler</button>
          <button className="connection-button" type="submit">Créer le contact</button>
        </div>
      </form>
    </Dialog>
  </div>;
}

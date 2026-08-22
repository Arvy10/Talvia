"use client";

import { useState, type FormEvent } from "react";
import { LuPlus, LuSend, LuUsers } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { EmptyState, GlassCard, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import { useSandbox } from "../state/SandboxProvider";
import type { ChannelId } from "../state/types";

const channels: Array<{ id: ChannelId; label: string }> = [
  { id: "linkedin", label: "LinkedIn" }, { id: "whatsapp", label: "WhatsApp" }, { id: "gmail", label: "Gmail" },
];

export function CampaignsClient() {
  const { state, dispatch } = useSandbox();
  const campaigns = state.campaigns ?? [];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("Prospection");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<ChannelId[]>([]);
  const [error, setError] = useState("");
  const close = () => { setOpen(false); setName(""); setObjective("Prospection"); setSelectedContacts([]); setSelectedChannels([]); setError(""); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError("Donnez un nom à la campagne."); return; }
    if (!selectedContacts.length) { setError("Sélectionnez au moins un contact."); return; }
    dispatch({ type: "CREATE_CAMPAIGN", campaign: { id: crypto.randomUUID(), name: name.trim(), objective, contactIds: selectedContacts, channels: selectedChannels, status: "draft", sequence: ["Message initial", "Attendre une réponse"] } });
    dispatch({ type: "ADD_ACTIVITY", activity: { id: crypto.randomUUID(), label: `Campagne « ${name.trim()} » créée en brouillon`, createdAt: new Date().toISOString() } });
    close();
  };
  const toggle = (id: string, list: string[], set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return <div className="campaigns-page">
    <PageHeader eyebrow="Actions commerciales" title="Campagnes" description="Créez et suivez vos actions commerciales multicanales dans votre environnement de test." actions={<button className="connection-button" onClick={() => setOpen(true)} type="button"><LuPlus />Nouvelle campagne</button>} />
    {campaigns.length === 0 ? <EmptyState icon={<LuSend />} title="Aucune campagne pour le moment" description="Créez votre première campagne pour engager les contacts que vous avez ajoutés." action={<button className="connection-button" onClick={() => setOpen(true)} type="button">Créer une campagne</button>} /> : <div className="campaign-grid">{campaigns.map((campaign) => <GlassCard className="campaign-card" key={campaign.id}><div className="campaign-card__top"><div><p className="page-header__eyebrow">{campaign.objective}</p><h2>{campaign.name}</h2></div><span className={`campaign-status campaign-status--${campaign.status}`}>{campaign.status === "draft" ? "Brouillon" : campaign.status}</span></div><p>{campaign.contactIds.length} contact(s) · {campaign.sequence.length} étapes</p><div className="campaign-card__channels">{campaign.channels.map((channel) => <ChannelLogo channel={channel} key={channel} />)}</div><button className="connection-button connection-button--secondary" onClick={() => dispatch({ type: "ADD_ACTIVITY", activity: { id: crypto.randomUUID(), label: `Campagne « ${campaign.name} » consultée`, createdAt: new Date().toISOString() } })} type="button">Voir le résumé</button></GlassCard>)}</div>}
    <Dialog description="Cette campagne reste entièrement locale et simulée." onClose={close} open={open} title="Nouvelle campagne"><form className="workspace-form" onSubmit={submit}><label><span>Nom <em>*</em></span><input autoFocus onChange={(e) => { setName(e.target.value); setError(""); }} value={name} />{error ? <small role="alert">{error}</small> : null}</label><label><span>Objectif</span><select onChange={(e) => setObjective(e.target.value)} value={objective}><option>Prospection</option><option>Relance</option><option>Réactivation</option><option>Annonce</option></select></label><fieldset><legend>Audience</legend>{state.contacts.length === 0 ? <p className="form-hint">Ajoutez d’abord un contact.</p> : state.contacts.map((contact) => <label className="form-check" key={contact.id}><input checked={selectedContacts.includes(contact.id)} onChange={() => toggle(contact.id, selectedContacts, setSelectedContacts)} type="checkbox" /><span>{contact.name}</span></label>)}</fieldset><fieldset><legend>Canaux</legend><div className="campaign-channel-options">{channels.map(({ id, label }) => <label className="form-check" key={id}><input checked={selectedChannels.includes(id)} onChange={() => toggle(id, selectedChannels, setSelectedChannels)} type="checkbox" /><ChannelLogo channel={id} /><span>{label}</span></label>)}</div></fieldset><div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={close} type="button">Annuler</button><button className="connection-button" type="submit"><LuUsers />Créer le brouillon</button></div></form></Dialog>
  </div>;
}

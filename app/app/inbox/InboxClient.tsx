"use client";

import { LuChevronLeft, LuInbox, LuPanelRight, LuSearch, LuSlidersHorizontal } from "react-icons/lu";

import { ChannelLogo } from "../connections/ChannelLogo";
import { EmptyState, PageHeader } from "../components/ui";
import { useSandbox } from "../state/SandboxProvider";
import { channelMap, getInboxAvailability, type InboxAvailability } from "./inbox-model";

const availabilityLabels: Record<InboxAvailability, string> = {
  disconnected: "Non connecté",
  syncing: "Synchronisation…",
  "connected-empty": "Prêt, aucune conversation",
  error: "Connexion à vérifier",
};

export function InboxClient() {
  const { state } = useSandbox();
  const availability = getInboxAvailability(state.connections);

  return <div className="inbox-page">
    <PageHeader
      eyebrow="Espace partagé"
      title="Inbox"
      description="Chaque conversation reliée à Talvia apparaîtra ici. Pour le moment, votre liste reste volontairement vide."
    />

    <section aria-label="Espace de conversations" className="inbox-workspace">
      <aside className="inbox-list-panel">
        <header className="inbox-list-panel__header">
          <div><p>CONVERSATIONS</p><h2>Tout est calme</h2></div>
          <LuSlidersHorizontal aria-hidden="true" />
        </header>
        <label className="inbox-search"><LuSearch aria-hidden="true" /><span className="sr-only">Rechercher dans les conversations</span><input disabled placeholder="Rechercher bientôt" type="search" /></label>
        <div aria-label="Filtres de canaux" className="inbox-channel-filters">
          {channelMap.map(({ id, label }) => <div className={`inbox-channel-filter inbox-channel-filter--${availability[id]}`} key={id}>
            <ChannelLogo channel={id} />
            <div><strong>{label}</strong><span>{availabilityLabels[availability[id]]}</span></div>
          </div>)}
        </div>
        <EmptyState
          className="inbox-list-empty"
          icon={<LuInbox />}
          title="Aucune conversation"
          description="Connectez un canal, puis les conversations réelles arriveront ici."
        />
      </aside>

      <section className="inbox-conversation-canvas">
        <button className="inbox-mobile-back" type="button"><LuChevronLeft aria-hidden="true" />Retour à la liste</button>
        <EmptyState
          icon={<LuInbox />}
          title="Sélectionnez une conversation"
          description="Dès qu’un échange arrivera dans votre inbox, vous pourrez le consulter ici sans quitter Talvia."
        />
      </section>

      <aside className="inbox-context-panel">
        <button className="inbox-mobile-back" type="button"><LuChevronLeft aria-hidden="true" />Retour</button>
        <div className="inbox-context-panel__heading"><LuPanelRight aria-hidden="true" /><div><p>CONTEXTE</p><h2>Aucun échange sélectionné</h2></div></div>
        <p>Les informations utiles d’une conversation seront affichées ici, uniquement après sa réception.</p>
      </aside>
    </section>
  </div>;
}

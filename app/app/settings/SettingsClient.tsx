"use client";

import { useState } from "react";
import Link from "next/link";
import { LuDatabase, LuRefreshCcw, LuShieldAlert, LuSlidersHorizontal } from "react-icons/lu";

import { Dialog } from "../components/Dialog";
import { GlassCard, PageHeader } from "../components/ui";
import { useSandbox } from "../state/SandboxProvider";

export function SettingsClient() {
  const { dispatch, state } = useSandbox();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const confirmReset = () => {
    dispatch({ type: "RESET_SANDBOX" });
    setIsResetDialogOpen(false);
    setAnnouncement("Le bac à sable a été réinitialisé.");
  };

  return <div className="settings-page">
    <PageHeader
      eyebrow="Environnement local"
      title="Paramètres"
      description="Consultez l’état de votre bac à sable et gérez ses préférences produit."
    />
    <p aria-live="polite" className="sr-only">{announcement}</p>

    <div className="settings-grid">
      <GlassCard className="settings-card">
        <div className="settings-card__heading"><LuSlidersHorizontal aria-hidden="true" /><div><p>SESSION</p><h2>Informations du bac à sable</h2></div></div>
        <dl className="settings-details">
          <div><dt>État de session</dt><dd>{state.sessionActive ? "Active" : "En attente"}</dd></div>
          <div><dt>Automatisations enregistrées</dt><dd>{state.automations.length}</dd></div>
          <div><dt>Canaux connectés</dt><dd>{Object.values(state.connections).filter(({ status }) => status === "connected").length}</dd></div>
        </dl>
      </GlassCard>

      <GlassCard className="settings-card">
        <div className="settings-card__heading"><LuDatabase aria-hidden="true" /><div><p>STOCKAGE</p><h2>Données locales</h2></div></div>
        <p>{state.storageAvailable ? "Le stockage local est disponible. Vos essais restent sur cet appareil." : "Le stockage local n’est pas disponible. Vos essais ne seront pas conservés après cette session."}</p>
      </GlassCard>

      <GlassCard className="settings-card">
        <div className="settings-card__heading"><LuSlidersHorizontal aria-hidden="true" /><div><p>WORKSPACE</p><h2>Workspace Talvia</h2></div></div>
        <dl className="settings-details"><div><dt>Nom</dt><dd>Sandbox Talvia</dd></div><div><dt>Type</dt><dd>Environnement local</dd></div><div><dt>Propriétaire</dt><dd><Link href="/app/profile">Voir mon profil</Link></dd></div></dl>
      </GlassCard>

      <GlassCard className="settings-card" id="subscription">
        <div className="settings-card__heading"><LuShieldAlert aria-hidden="true" /><div><p>ABONNEMENT</p><h2>Plan sandbox</h2></div></div>
        <p>Le prototype fonctionne sans abonnement ni paiement réel. La facturation sera ajoutée lors de l’intégration du produit.</p>
      </GlassCard>

      <GlassCard className="settings-card settings-card--preferences">
        <div className="settings-card__heading"><LuSlidersHorizontal aria-hidden="true" /><div><p>PRODUIT</p><h2>Préférences</h2></div></div>
        <dl className="settings-details">
          <div><dt>Langue de l’interface</dt><dd>Français</dd></div>
          <div><dt>Mode</dt><dd>Bac à sable</dd></div>
          <div><dt>Automatisations</dt><dd>Validation locale</dd></div>
        </dl>
      </GlassCard>
    </div>

    <GlassCard className="settings-danger-zone">
      <div><div className="settings-card__heading"><LuShieldAlert aria-hidden="true" /><div><p>ZONE SENSIBLE</p><h2>Réinitialiser le bac à sable</h2></div></div><p>Supprime les connexions simulées, contacts, messages, campagnes, opportunités, automatisations et activités créés pendant vos essais.</p></div>
      <button className="connection-button connection-button--danger" onClick={() => setIsResetDialogOpen(true)} type="button"><LuRefreshCcw aria-hidden="true" />Réinitialiser</button>
    </GlassCard>

    <Dialog
      description="Cette action réinitialise toutes les données de votre bac à sable local."
      onClose={() => setIsResetDialogOpen(false)}
      open={isResetDialogOpen}
      title="Réinitialiser le bac à sable ?"
    >
      <div className="settings-reset-dialog"><p>Les configurations enregistrées dans cet environnement seront supprimées.</p><div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={() => setIsResetDialogOpen(false)} type="button">Annuler</button><button className="connection-button connection-button--danger" onClick={confirmReset} type="button">Confirmer la réinitialisation</button></div></div>
    </Dialog>
  </div>;
}

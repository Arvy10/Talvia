"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LuPencil } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { PageHeader } from "../components/ui";

type Workspace = {
  name: string;
  default_locale: string;
  default_timezone: string;
  ai_instructions: string;
  first_name: string;
  last_name: string;
  email: string;
};

type Editor = "workspace" | "preferences" | "profile" | null;

const localeLabels: Record<string, string> = { fr: "Français", en: "English" };

export function SettingsClient() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [connections, setConnections] = useState(0);
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState("");
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  useEffect(() => {
    void Promise.all([fetch("/api/workspace"), fetch("/api/connections")]).then(async ([a, b]) => {
      if (a.ok) setWorkspace((await a.json() as { workspace: Workspace }).workspace);
      if (b.ok) setConnections((await b.json() as { connections: Array<{ status: string }> }).connections.filter((item) => item.status === "connected").length);
    });
  }, []);

  const save = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const body: Record<string, string> = {};
    if (editor === "workspace") body.name = String(data.get("name") ?? workspace?.name ?? "");
    if (editor === "preferences") { body.name = workspace?.name ?? ""; body.locale = String(data.get("locale") ?? workspace?.default_locale ?? "fr"); body.timezone = String(data.get("timezone") ?? workspace?.default_timezone ?? "Africa/Brazzaville"); }
    if (editor === "profile") { body.firstName = String(data.get("firstName") ?? ""); body.lastName = String(data.get("lastName") ?? ""); }
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) { setWorkspace((await response.json() as { workspace: Workspace }).workspace); setNotice("Paramètres enregistrés."); setEditor(null); }
  };

  const saveAiInstructions = async () => {
    if (aiDraft === null) return;
    setAiSaving(true);
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ aiInstructions: aiDraft }) });
    if (response.ok) { setWorkspace((await response.json() as { workspace: Workspace }).workspace); setNotice("Instructions enregistrées."); setAiDraft(null); }
    setAiSaving(false);
  };

  const fullName = workspace ? `${workspace.first_name} ${workspace.last_name}`.trim() : "";
  const initials = fullName ? fullName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") : "…";
  const aiValue = aiDraft ?? workspace?.ai_instructions ?? "";
  const aiDirty = aiDraft !== null && aiDraft !== (workspace?.ai_instructions ?? "");

  return <div className="settings-page">
    <PageHeader eyebrow="Workspace Talvia" title="Paramètres" description="Gérez votre profil, votre workspace et vos préférences persistées." />
    <p aria-live="polite" className="sr-only">{notice}</p>

    <div className="settings-shell">
      <header className="settings-profile-header">
        <span aria-hidden="true" className="settings-avatar">{initials}</span>
        <div className="settings-profile-header__identity">
          <h1>{workspace ? (fullName || "Compléter mon profil") : "Chargement…"}</h1>
          <p>{workspace?.email ?? "—"}</p>
        </div>
        <button className="icon-button settings-profile-header__edit" aria-label="Modifier le profil" onClick={() => setEditor("profile")} type="button"><LuPencil aria-hidden="true" /></button>
      </header>

      <section className="settings-section">
        <div className="settings-section__head"><h2>Compte</h2></div>
        <div className="settings-row"><div className="settings-row__label"><strong>État de la session</strong></div><span className="settings-row__value settings-row__value--positive">Active</span></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Canaux connectés</strong><small>Sur {connections === 1 ? "1 canal actif" : `${connections} canaux actifs`}</small></div><span className="settings-row__value">{connections}</span></div>
      </section>

      <section className="settings-section">
        <div className="settings-section__head"><h2>Workspace</h2></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Nom du workspace</strong></div><span className="settings-row__value">{workspace?.name ?? "—"}</span><button className="settings-row__action" onClick={() => setEditor("workspace")} type="button">Modifier</button></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Langue</strong></div><span className="settings-row__value">{localeLabels[workspace?.default_locale ?? "fr"] ?? workspace?.default_locale}</span><button className="settings-row__action" onClick={() => setEditor("preferences")} type="button">Modifier</button></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Fuseau horaire</strong></div><span className="settings-row__value">{workspace?.default_timezone ?? "—"}</span></div>
      </section>

      <section className="settings-section">
        <div className="settings-section__head"><h2>Assistant IA</h2><p>Décrivez le ton, le style et le contexte que l’assistant doit connaître avant de préparer une réponse.</p></div>
        <div className="settings-ai-editor">
          <textarea
            maxLength={4000}
            onChange={(event) => setAiDraft(event.target.value)}
            placeholder="Ex. : Réponds toujours en français, sur un ton chaleureux et direct. Notre équipe s’appelle..."
            rows={7}
            value={aiValue}
          />
          <div className="settings-ai-editor__actions">
            <span>{aiValue.length}/4000</span>
            <button className="connection-button" disabled={!aiDirty || aiSaving} onClick={() => void saveAiInstructions()} type="button">{aiSaving ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__head"><h2>Abonnement</h2></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Formule actuelle</strong><small>Accès de lancement — aucun paiement demandé à cette étape.</small></div><span className="settings-row__value">Talvia Early</span></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Formules payantes</strong><small>Vous serez informé avant leur ouverture.</small></div><Link className="settings-row__action" href="/#tarifs">Voir</Link></div>
      </section>

      <section className="settings-section">
        <div className="settings-section__head"><h2>Données</h2></div>
        <div className="settings-row"><div className="settings-row__label"><strong>Stockage</strong><small>Vos données sont enregistrées dans votre workspace PostgreSQL/Neon.</small></div></div>
      </section>
    </div>

    <Dialog description="Ces réglages sont enregistrés dans votre workspace Talvia." onClose={() => setEditor(null)} open={editor !== null} title={editor === "workspace" ? "Modifier le workspace" : editor === "profile" ? "Mon profil" : "Préférences"}>
      <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
        {editor === "workspace" ? <label><span>Nom du workspace</span><input defaultValue={workspace?.name ?? ""} name="name" /></label> : null}
        {editor === "profile" ? <><label><span>Prénom</span><input defaultValue={workspace?.first_name ?? ""} name="firstName" /></label><label><span>Nom</span><input defaultValue={workspace?.last_name ?? ""} name="lastName" /></label></> : null}
        {editor === "preferences" ? <><label><span>Langue</span><select defaultValue={workspace?.default_locale ?? "fr"} name="locale"><option value="fr">Français</option><option value="en">English</option></select></label><label><span>Fuseau horaire</span><input defaultValue={workspace?.default_timezone ?? "Africa/Brazzaville"} name="timezone" /></label></> : null}
        <div className="workspace-form__actions">
          <button className="connection-button connection-button--secondary" onClick={() => setEditor(null)} type="button">Annuler</button>
          <button className="connection-button" type="submit">Enregistrer</button>
        </div>
      </form>
    </Dialog>
  </div>;
}

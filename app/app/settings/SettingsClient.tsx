"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LuDatabase, LuPencil, LuShieldAlert, LuSlidersHorizontal, LuSparkles, LuUserRound, LuWallet } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { GlassCard, PageHeader } from "../components/ui";

type Workspace = {
  name: string;
  default_locale: string;
  default_timezone: string;
  ai_instructions: string;
  first_name: string;
  last_name: string;
  email: string;
};

type Editor = "workspace" | "preferences" | "profile" | "ai" | null;

export function SettingsClient() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [connections, setConnections] = useState(0);
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState("");

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
    if (editor === "ai") body.aiInstructions = String(data.get("aiInstructions") ?? "");
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) { setWorkspace((await response.json() as { workspace: Workspace }).workspace); setNotice("Paramètres enregistrés."); setEditor(null); }
  };

  return <div className="settings-page">
    <PageHeader eyebrow="Workspace Talvia" title="Paramètres" description="Gérez votre profil, votre workspace et vos préférences persistées." />
    <p aria-live="polite" className="sr-only">{notice}</p>

    <div className="settings-grid">
      <GlassCard className="settings-card settings-card--large settings-card--interactive" onClick={() => setEditor("profile")}>
        <div className="settings-card__heading settings-card__heading--violet"><LuUserRound /><div><p>PROFIL</p><h2>{workspace ? `${workspace.first_name || "Prénom"} ${workspace.last_name || "Nom"}`.trim() : "Chargement…"}</h2></div></div>
        <p>{workspace?.email ?? "—"}</p>
        <span className="settings-card__edit"><LuPencil />Modifier</span>
      </GlassCard>

      <GlassCard className="settings-card settings-card--large">
        <div className="settings-card__heading"><LuSlidersHorizontal /><div><p>SESSION</p><h2>Compte connecté</h2></div></div>
        <dl className="settings-details"><div><dt>État</dt><dd>Active</dd></div><div><dt>Email</dt><dd>{workspace?.email ?? "Chargement…"}</dd></div><div><dt>Canaux connectés</dt><dd>{connections}</dd></div></dl>
      </GlassCard>

      <GlassCard className="settings-card settings-card--large settings-card--interactive" onClick={() => setEditor("workspace")}>
        <div className="settings-card__heading"><LuSlidersHorizontal /><div><p>WORKSPACE</p><h2>{workspace?.name ?? "Chargement…"}</h2></div></div>
        <p>Workspace persistant.</p>
        <span className="settings-card__edit"><LuPencil />Modifier</span>
      </GlassCard>

      <GlassCard className="settings-card settings-card--large settings-card--interactive" onClick={() => setEditor("preferences")}>
        <div className="settings-card__heading"><LuShieldAlert /><div><p>PRÉFÉRENCES</p><h2>Langue et fuseau horaire</h2></div></div>
        <p>{workspace?.default_locale ?? "fr"} · {workspace?.default_timezone ?? "Africa/Brazzaville"}</p>
        <span className="settings-card__edit"><LuPencil />Modifier</span>
      </GlassCard>

      <GlassCard className="settings-card settings-card--large settings-card--interactive" onClick={() => setEditor("ai")}>
        <div className="settings-card__heading settings-card__heading--violet"><LuSparkles /><div><p>ASSISTANT IA</p><h2>Instructions personnalisées</h2></div></div>
        <p>{workspace?.ai_instructions ? "Des instructions sont enregistrées pour guider les réponses proposées." : "Décrivez le ton, le style et le contexte que l’assistant doit connaître."}</p>
        <span className="settings-card__edit"><LuPencil />Modifier</span>
      </GlassCard>

      <GlassCard className="settings-card settings-card--large">
        <div className="settings-card__heading"><LuWallet /><div><p>ABONNEMENT</p><h2>Talvia Early</h2></div></div>
        <p>Accès de lancement. Aucun paiement n’est demandé à cette étape — vous serez informé avant l’ouverture des formules payantes.</p>
        <Link className="settings-card__edit" href="/#tarifs">Voir les formules à venir</Link>
      </GlassCard>

      <GlassCard className="settings-card settings-card--large">
        <div className="settings-card__heading"><LuDatabase /><div><p>STOCKAGE</p><h2>Données Talvia</h2></div></div>
        <p>Vos données sont enregistrées dans votre workspace PostgreSQL/Neon.</p>
      </GlassCard>
    </div>

    <Dialog description="Ces réglages sont enregistrés dans votre workspace Talvia." onClose={() => setEditor(null)} open={editor !== null} title={editor === "workspace" ? "Modifier le workspace" : editor === "profile" ? "Mon profil" : editor === "ai" ? "Instructions pour l’assistant IA" : "Préférences"}>
      <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
        {editor === "workspace" ? <label><span>Nom du workspace</span><input defaultValue={workspace?.name ?? ""} name="name" /></label> : null}
        {editor === "profile" ? <><label><span>Prénom</span><input defaultValue={workspace?.first_name ?? ""} name="firstName" /></label><label><span>Nom</span><input defaultValue={workspace?.last_name ?? ""} name="lastName" /></label></> : null}
        {editor === "preferences" ? <><label><span>Langue</span><select defaultValue={workspace?.default_locale ?? "fr"} name="locale"><option value="fr">Français</option><option value="en">English</option></select></label><label><span>Fuseau horaire</span><input defaultValue={workspace?.default_timezone ?? "Africa/Brazzaville"} name="timezone" /></label></> : null}
        {editor === "ai" ? <label><span>Instructions <i>(ton, style, contexte à connaître)</i></span><textarea defaultValue={workspace?.ai_instructions ?? ""} maxLength={4000} name="aiInstructions" placeholder="Ex. : Réponds toujours en français, sur un ton chaleureux et direct. Notre équipe s’appelle..." rows={7} /></label> : null}
        <div className="workspace-form__actions">
          <button className="connection-button connection-button--secondary" onClick={() => setEditor(null)} type="button">Annuler</button>
          <button className="connection-button" type="submit">Enregistrer</button>
        </div>
      </form>
    </Dialog>
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import { PageHeader, GlassCard } from "../components/ui";

type Workspace = { name: string; default_locale: string; default_timezone: string; first_name: string; last_name: string; email: string };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Workspace | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { void fetch("/api/workspace").then(async (r) => r.ok ? r.json() : null).then((data) => setProfile(data?.workspace ?? null)); }, []);
  const save = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: String(data.get("firstName") ?? ""), lastName: String(data.get("lastName") ?? "") }) });
    if (response.ok) { const body = await response.json() as { workspace: Workspace }; setProfile(body.workspace); setSaved(true); }
  };
  return <div className="profile-page"><PageHeader eyebrow="Compte Talvia" title="Mon profil" description="Votre profil est enregistré dans votre workspace Talvia." /><GlassCard className="settings-card"><form className="workspace-form" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}><label><span>Prénom</span><input defaultValue={profile?.first_name ?? ""} name="firstName" /></label><label><span>Nom</span><input defaultValue={profile?.last_name ?? ""} name="lastName" /></label><label><span>Email</span><input defaultValue={profile?.email ?? ""} disabled type="email" /></label><label><span>Langue</span><input defaultValue={profile?.default_locale ?? "fr"} disabled /></label><label><span>Fuseau horaire</span><input defaultValue={profile?.default_timezone ?? "Africa/Brazzaville"} disabled /></label><button className="connection-button" type="submit">{saved ? "Profil enregistré" : "Enregistrer le profil"}</button></form></GlassCard></div>;
}

"use client";

import { useState } from "react";
import { PageHeader, GlassCard } from "../components/ui";
import { useSandbox } from "../state/SandboxProvider";
import type { SandboxProfile } from "../state/types";

export default function ProfilePage() {
  const [saved, setSaved] = useState(false);
  const { state, dispatch } = useSandbox();
  const profile: SandboxProfile = state.profile ?? { firstName: "Test", lastName: "Sandbox", email: "sandbox@talvia.local", language: "Français", timezone: "Africa/Brazzaville" };
  const save = (form: HTMLFormElement) => { const data = new FormData(form); dispatch({ type: "UPDATE_PROFILE", profile: { firstName: String(data.get("firstName") ?? ""), lastName: String(data.get("lastName") ?? ""), email: String(data.get("email") ?? ""), company: String(data.get("company") ?? ""), role: String(data.get("role") ?? ""), language: "Français", timezone: "Africa/Brazzaville" } }); setSaved(true); };
  return <div className="profile-page"><PageHeader eyebrow="Compte Talvia" title="Mon profil" description="Votre profil Talvia est indépendant des canaux connectés et reste local au sandbox." /><GlassCard className="settings-card"><form className="workspace-form" onSubmit={(event) => { event.preventDefault(); save(event.currentTarget); }}><label><span>Prénom</span><input defaultValue={profile.firstName} name="firstName" /></label><label><span>Nom</span><input defaultValue={profile.lastName} name="lastName" /></label><label><span>Email</span><input defaultValue={profile.email} name="email" type="email" /></label><label><span>Entreprise</span><input defaultValue={profile.company} name="company" placeholder="Votre organisation" /></label><label><span>Rôle</span><input defaultValue={profile.role} name="role" placeholder="Votre rôle" /></label><label><span>Langue</span><select defaultValue={profile.language} disabled><option>Français</option></select></label><label><span>Fuseau horaire</span><select defaultValue={profile.timezone} disabled><option>Africa/Brazzaville</option></select></label><button className="connection-button" type="submit">{saved ? "Profil enregistré" : "Enregistrer le profil"}</button></form></GlassCard></div>;
}

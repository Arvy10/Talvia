"use client";

import { useState } from "react";
import { PageHeader, GlassCard } from "../components/ui";

export default function ProfilePage() {
  const [saved, setSaved] = useState(false);
  return <div className="profile-page"><PageHeader eyebrow="Compte Talvia" title="Mon profil" description="Votre profil Talvia est indépendant des canaux connectés et reste local au sandbox." /><GlassCard className="settings-card"><div className="workspace-form"><label><span>Prénom</span><input defaultValue="Test" /></label><label><span>Nom</span><input defaultValue="Sandbox" /></label><label><span>Email</span><input defaultValue="sandbox@talvia.local" type="email" /></label><label><span>Entreprise</span><input placeholder="Votre organisation" /></label><label><span>Rôle</span><input placeholder="Votre rôle" /></label><button className="connection-button" onClick={() => setSaved(true)} type="button">{saved ? "Profil enregistré" : "Enregistrer le profil"}</button></div></GlassCard></div>;
}

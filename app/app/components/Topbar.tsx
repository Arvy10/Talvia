"use client";

import Link from "next/link";

import { useSandbox } from "../state/SandboxProvider";

export function Topbar({ title, onNavigationOpen }: { title: string; onNavigationOpen: () => void }) {
  const { hydrated, state } = useSandbox();

  return <header className="app-topbar">
    <button aria-label="Ouvrir la navigation" className="app-topbar__brand" onClick={onNavigationOpen} type="button"><span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span></button>
    <p>{title}</p>
    <div className="app-topbar__actions"><span className="sandbox-indicator">{hydrated && !state.storageAvailable ? "Session temporaire" : "Bac à sable"}</span><Link className="app-topbar__logout" href="/login">Se déconnecter</Link></div>
  </header>;
}

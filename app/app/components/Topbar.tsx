"use client";

import { useSandbox } from "../state/SandboxProvider";
import { SignOutButton } from "./SignOutButton";

export function Topbar({ title, onNavigationOpen }: { title: string; onNavigationOpen: () => void }) {
  const { hydrated, state } = useSandbox();

  return <header className="app-topbar">
    <button aria-label="Ouvrir la navigation" className="app-topbar__brand" onClick={onNavigationOpen} type="button"><span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span></button>
    <p>{title}</p>
    <div className="app-topbar__actions"><span className="sandbox-indicator">{hydrated && !state.storageAvailable ? "Session temporaire" : "Bac à sable"}</span><SignOutButton className="app-topbar__logout" /></div>
  </header>;
}

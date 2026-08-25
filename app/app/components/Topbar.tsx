"use client";

import { TopbarAccountMenu } from "./TopbarAccountMenu";

export function Topbar({ title, onNavigationOpen }: { title: string; onNavigationOpen: () => void }) {
  return <header className="app-topbar">
    <button aria-label="Ouvrir la navigation" className="app-topbar__brand" onClick={onNavigationOpen} type="button"><span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span></button>
    <p>{title}</p>
    <div className="app-topbar__actions"><TopbarAccountMenu /></div>
  </header>;
}

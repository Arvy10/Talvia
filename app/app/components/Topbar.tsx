"use client";

import { BellRing } from "@animateicons/react/lucide";

import { IconButton } from "./ui";
import { TopbarAccountMenu } from "./TopbarAccountMenu";
import { TopbarClock } from "./TopbarClock";

export function Topbar({ title, onNavigationOpen }: { title: string; onNavigationOpen: () => void }) {
  return <header className="app-topbar">
    <button aria-label="Ouvrir la navigation" className="app-topbar__brand" onClick={onNavigationOpen} type="button"><span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span></button>
    <p>{title}</p>
    <div className="app-topbar__actions">
      <TopbarClock />
      <IconButton className="app-topbar__bell" label="Notifications"><BellRing aria-hidden="true" duration={0.8} size={18} /></IconButton>
      <TopbarAccountMenu />
    </div>
  </header>;
}

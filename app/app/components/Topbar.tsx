"use client";

import { LuBell } from "react-icons/lu";

import { IconButton } from "./ui";
import { TopbarAccountMenu } from "./TopbarAccountMenu";
import { TopbarClock } from "./TopbarClock";

export function Topbar({ title, onNavigationOpen }: { title: string; onNavigationOpen: () => void }) {
  return <header className="app-topbar">
    <button aria-label="Ouvrir la navigation" className="app-topbar__brand" onClick={onNavigationOpen} type="button"><span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span></button>
    <p>{title}</p>
    <div className="app-topbar__actions">
      <TopbarClock />
      <IconButton className="app-topbar__bell" label="Notifications"><LuBell aria-hidden="true" /></IconButton>
      <TopbarAccountMenu />
    </div>
  </header>;
}

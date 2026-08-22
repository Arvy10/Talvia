"use client";

import { LuMenu } from "react-icons/lu";

import { useSandbox } from "../state/SandboxProvider";
import { IconButton } from "./ui";

export function Topbar({ title, onMenuOpen }: { title: string; onMenuOpen: () => void }) {
  const { hydrated, state } = useSandbox();

  return <header className="app-topbar">
    <IconButton className="app-topbar__menu" label="Ouvrir la navigation" onClick={onMenuOpen}><LuMenu aria-hidden="true" /></IconButton>
    <p>{title}</p>
    <span className="sandbox-indicator">{hydrated && !state.storageAvailable ? "Session temporaire" : "Bac à sable"}</span>
  </header>;
}

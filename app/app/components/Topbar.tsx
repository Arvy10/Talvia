"use client";

import { LuMenu } from "react-icons/lu";
import Link from "next/link";

import { useSandbox } from "../state/SandboxProvider";
import { IconButton } from "./ui";

export function Topbar({ title, onMenuOpen }: { title: string; onMenuOpen: () => void }) {
  const { hydrated, state } = useSandbox();

  return <header className="app-topbar">
    <IconButton className="app-topbar__menu" label="Ouvrir la navigation" onClick={onMenuOpen}><LuMenu aria-hidden="true" /></IconButton>
    <p>{title}</p>
    <div className="app-topbar__actions"><span className="sandbox-indicator">{hydrated && !state.storageAvailable ? "Session temporaire" : "Bac à sable"}</span><Link className="app-topbar__logout" href="/login">Se déconnecter</Link></div>
  </header>;
}

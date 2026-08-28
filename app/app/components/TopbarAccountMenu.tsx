"use client";

import Link from "next/link";
import { LuSettings } from "react-icons/lu";

import { SignOutButton } from "./SignOutButton";
import { getInitials, useUserIdentity } from "./useUserIdentity";

export function TopbarAccountMenu() {
  const identity = useUserIdentity();
  return (
    <details className="app-topbar__account">
      <summary aria-label="Compte">
        <span aria-hidden="true">{getInitials(identity)}</span>
      </summary>
      <div className="app-topbar__account-panel">
        <Link href="/app/settings">
          <LuSettings aria-hidden="true" /> Paramètres
        </Link>
        <SignOutButton className="app-topbar__account-logout" />
      </div>
    </details>
  );
}

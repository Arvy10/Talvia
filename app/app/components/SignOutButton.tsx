"use client";

import { useState } from "react";
import { LuLogOut } from "react-icons/lu";

import { authClient } from "../../lib/auth-client";
import { Dialog } from "./Dialog";

export function SignOutButton({ className, onComplete }: { className?: string; onComplete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirmSignOut() {
    setPending(true);
    await authClient.signOut();
    onComplete?.();
    window.location.assign("/login");
  }

  return (
    <>
      <button className={className} onClick={() => setOpen(true)} type="button">
        <LuLogOut aria-hidden="true" /> Se déconnecter
      </button>
      <Dialog
        description="Vous devrez vous reconnecter pour retrouver votre espace."
        onClose={() => setOpen(false)}
        open={open}
        title="Se déconnecter ?"
      >
        <div className="connection-dialog__actions">
          <button className="connection-button connection-button--secondary" onClick={() => setOpen(false)} type="button">
            Annuler
          </button>
          <button className="connection-button connection-button--danger" disabled={pending} onClick={confirmSignOut} type="button">
            {pending ? "Déconnexion…" : "Se déconnecter"}
          </button>
        </div>
      </Dialog>
    </>
  );
}

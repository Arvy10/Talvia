"use client";

import { useState } from "react";
import { LuLogOut } from "react-icons/lu";

import { authClient } from "../../lib/auth-client";
import { clearSandboxState } from "../state/storage";
import { Dialog } from "./Dialog";

export function SignOutButton({ className, onComplete }: { className?: string; onComplete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function confirmSignOut() {
    setPending(true);
    setError("");
    const session = await authClient.getSession().catch(() => null);
    const { error: signOutError } = await authClient.signOut();
    setPending(false);
    if (signOutError) {
      setError("La déconnexion a échoué. Réessayez.");
      return;
    }
    // The session is already revoked server-side at this point — clear the
    // local per-user data too so it isn't left sitting in this browser.
    clearSandboxState(session?.data?.user?.id ?? null);
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
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="connection-dialog__actions">
          <button className="connection-button connection-button--secondary" onClick={() => setOpen(false)} type="button">
            Annuler
          </button>
          <button className="connection-button connection-button--danger" disabled={pending} onClick={() => void confirmSignOut()} type="button">
            {pending ? "Déconnexion…" : "Se déconnecter"}
          </button>
        </div>
      </Dialog>
    </>
  );
}

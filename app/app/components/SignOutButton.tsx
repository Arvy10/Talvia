"use client";

import { authClient } from "../../lib/auth-client";

export function SignOutButton({ className, onComplete }: { className?: string; onComplete?: () => void }) {
  return <button className={className} onClick={async () => { await authClient.signOut(); onComplete?.(); window.location.assign("/login"); }} type="button">Se déconnecter</button>;
}

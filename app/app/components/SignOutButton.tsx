"use client";

import { useRouter } from "next/navigation";

import { authClient } from "../../lib/auth-client";

export function SignOutButton({ className, onComplete }: { className?: string; onComplete?: () => void }) {
  const router = useRouter();
  return <button className={className} onClick={async () => { await authClient.signOut(); onComplete?.(); router.replace("/login"); router.refresh(); }} type="button">Se déconnecter</button>;
}

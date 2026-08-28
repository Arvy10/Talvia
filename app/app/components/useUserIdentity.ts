"use client";

import { useEffect, useState } from "react";

export type UserIdentity = { firstName: string; lastName: string; email: string };

const emptyIdentity: UserIdentity = { firstName: "", lastName: "", email: "" };

export function getInitials({ firstName, lastName, email }: UserIdentity): string {
  const first = firstName.trim().charAt(0);
  const last = lastName.trim().charAt(0);
  if (first || last) return `${first}${last}`.toUpperCase();
  return email.trim().charAt(0).toUpperCase() || "?";
}

export function useUserIdentity(): UserIdentity {
  const [identity, setIdentity] = useState<UserIdentity>(emptyIdentity);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { workspace: { first_name?: string; last_name?: string; email?: string } } | null) => {
        if (cancelled || !data) return;
        setIdentity({
          firstName: data.workspace.first_name ?? "",
          lastName: data.workspace.last_name ?? "",
          email: data.workspace.email ?? "",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return identity;
}

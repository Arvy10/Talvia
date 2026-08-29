"use client";

import { FormEvent, useState } from "react";

const attributionKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export function BetaSignupForm({ search }: { search: string }) {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("submitting"); setError("");
    const form = new FormData(event.currentTarget); const params = new URLSearchParams(search);
    const attribution = Object.fromEntries(attributionKeys.map((key) => [key, params.get(key) ?? undefined]));
    try {
      const utm = Object.fromEntries(Object.entries(attribution).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
      const response = await fetch("/api/acquisition/beta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: form.get("firstName"), email: form.get("email"), role: form.get("role"), landingUrl: window.location.href, ...utm }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Inscription impossible.");
      setState("success");
    } catch (reason) { setState("error"); setError(reason instanceof Error ? reason.message : "Inscription impossible."); }
  }
  if (state === "success") return <p role="status">Votre inscription est enregistrée. Nous vous écrirons quand la bêta avancera.</p>;
  return <form onSubmit={submit}><label>Prénom<input name="firstName" autoComplete="given-name" /></label><label>E-mail<input aria-label="E-mail" name="email" required type="email" autoComplete="email" /></label><label>Activité ou rôle <small>(facultatif)</small><input name="role" autoComplete="organization-title" /></label>{state === "error" ? <p role="alert">{error}</p> : null}<button disabled={state === "submitting"} type="submit">{state === "submitting" ? "Inscription…" : "Tester Talvia"}</button></form>;
}

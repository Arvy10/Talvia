import { BetaSignupForm } from "./BetaSignupForm";

export default async function BetaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const search = new URLSearchParams(Object.entries(values).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])).toString();
  return <main className="auth-page"><section className="auth-card"><p>ACCÈS ANTICIPÉ</p><h1>Tester Talvia</h1><p>Inscrivez-vous pour suivre l’ouverture de la bêta privée.</p><BetaSignupForm search={search ? `?${search}` : ""} /></section></main>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LuArrowRight, LuGlobe, LuTriangleAlert } from "react-icons/lu";

import { GlassCard, PageHeader } from "../components/ui";
import type { BusinessContextRecord } from "../../lib/business-context/business-context-service";
import { BUSINESS_CONTEXT_SECTION_TITLES, BusinessContextForm, toEditable, toEditInput, type EditableBusinessContext } from "./BusinessContextForm";

type Step = "loading" | "url" | "analyzing" | "review" | "failed";

// Cosmetic microcopy only — Talvia makes a single request-response call to
// the backend, so there is no real per-step server confirmation to display.
// This cycles indefinitely (never marks a stage "done") until the actual
// response arrives, so it never implies progress the frontend hasn't
// actually confirmed.
const progressStages = [
  "Lecture de votre site",
  "Compréhension de votre activité",
  "Identification de votre contexte commercial",
  "Préparation de votre espace",
];

// Bounds the whole request (page fetches + AI call) so the UI always
// resolves to a clear result instead of spinning indefinitely if
// something downstream hangs — worst realistic case is well under this.
const ANALYSIS_TIMEOUT_MS = 45_000;

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function OnboardingClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [website, setWebsite] = useState("");
  const [record, setRecord] = useState<BusinessContextRecord | null>(null);
  const [editable, setEditable] = useState<EditableBusinessContext>(toEditable(null));
  const [failureReason, setFailureReason] = useState("");
  const [progressStage, setProgressStage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeSection, setActiveSection] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void fetch("/api/business-context").then((response) => (response.ok ? readJson<{ businessContext: BusinessContextRecord | null }>(response) : null)).then((data) => {
      const existing = data?.businessContext ?? null;
      if (existing && existing.status === "ready") {
        setRecord(existing);
        setEditable(toEditable(existing));
        setActiveSection(0);
        setStep("review");
        return;
      }
      if (existing && (existing.status === "error" || existing.status === "insufficient_content")) {
        setWebsite(existing.website ?? "");
        setFailureReason(existing.errorReason ?? "L'analyse précédente n'a pas abouti.");
        setStep("failed");
        return;
      }
      setStep("url");
    });
  }, []);

  useEffect(() => () => {
    if (progressTimer.current) clearInterval(progressTimer.current);
  }, []);

  const startProgressAnimation = () => {
    setProgressStage(0);
    progressTimer.current = setInterval(() => {
      setProgressStage((current) => (current + 1) % progressStages.length);
    }, 1800);
  };

  const stopProgressAnimation = () => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = null;
  };

  const runAnalysis = async (targetWebsite: string) => {
    setStep("analyzing");
    startProgressAnimation();
    let response: Response;
    try {
      response = await fetch("/api/business-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ website: targetWebsite }),
        signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      });
    } catch (error) {
      stopProgressAnimation();
      setFailureReason(error instanceof DOMException && error.name === "TimeoutError" ? "L'analyse a pris trop de temps et a été interrompue." : "Impossible de contacter le serveur.");
      setStep("failed");
      return;
    }
    stopProgressAnimation();

    if (!response.ok) {
      const body = await readJson<{ error?: string }>(response).catch(() => ({ error: undefined }));
      setFailureReason(body.error ?? "Une erreur est survenue pendant l'analyse.");
      setStep("failed");
      return;
    }

    const { businessContext } = await readJson<{ businessContext: BusinessContextRecord }>(response);
    if (businessContext.status === "ready") {
      setRecord(businessContext);
      setEditable(toEditable(businessContext));
      setActiveSection(0);
      setStep("review");
    } else {
      setFailureReason(businessContext.errorReason ?? "L'analyse n'a pas abouti.");
      setStep("failed");
    }
  };

  const startManual = async () => {
    const response = await fetch("/api/business-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manual: true }),
    });
    if (!response.ok) {
      const body = await readJson<{ error?: string }>(response).catch(() => ({ error: undefined }));
      setNotice(body.error ?? "Impossible de démarrer le profil manuel pour le moment.");
      return;
    }
    const { businessContext } = await readJson<{ businessContext: BusinessContextRecord }>(response);
    setRecord(businessContext);
    setEditable(toEditable(businessContext));
    setActiveSection(0);
    setStep("review");
  };

  const save = async () => {
    setSaving(true);
    const response = await fetch("/api/business-context", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toEditInput(editable)),
    });
    setSaving(false);
    if (!response.ok) { setNotice("Impossible d'enregistrer ce profil pour le moment."); return; }
    setNotice("Profil d'entreprise enregistré.");
    router.push("/app/settings");
  };

  return <div className="onboarding-page">
    <PageHeader
      description="Décrivez votre activité pour préparer un contexte que Talvia pourra utiliser dans vos échanges."
      eyebrow="Contexte d'entreprise"
      title="Parlez-nous de votre activité"
    />
    {notice ? <p aria-live="polite" className="onboarding-notice" role="status">{notice}</p> : null}

    {step === "loading" ? <GlassCard className="onboarding-card"><p className="onboarding-loading">Chargement…</p></GlassCard> : null}

    {step === "url" ? <GlassCard className="onboarding-card">
      <div className="onboarding-url">
        <span className="onboarding-url__icon" aria-hidden="true"><LuGlobe /></span>
        <h2>Quelle est l'adresse de votre site web ?</h2>
        <p>Talvia va lire votre page d'accueil et quelques pages clés (À propos, Services, Tarifs) pour préparer un profil de votre activité.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (website.trim()) void runAnalysis(website.trim()); }}>
          <input
            inputMode="url"
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://votre-site.com"
            required
            type="url"
            value={website}
          />
          <button className="connection-button" type="submit">Analyser<LuArrowRight aria-hidden="true" /></button>
        </form>
        <button className="connection-button connection-button--quiet" onClick={() => void startManual()} type="button">Je préfère renseigner ces informations moi-même</button>
      </div>
    </GlassCard> : null}

    {step === "analyzing" ? <GlassCard className="onboarding-card">
      <div className="onboarding-progress">
        <h2>Talvia analyse votre entreprise</h2>
        <p aria-live="polite" className="onboarding-progress__current">
          <span aria-hidden="true" className="onboarding-progress__spinner" />
          {progressStages[progressStage]}
        </p>
        <p className="onboarding-progress__note">Cette étape peut prendre quelques instants — l'analyse est toujours en cours tant que cet écran s'affiche.</p>
      </div>
    </GlassCard> : null}

    {step === "failed" ? <GlassCard className="onboarding-card">
      <div className="onboarding-failed">
        <span className="onboarding-failed__icon" aria-hidden="true"><LuTriangleAlert /></span>
        <h2>L'analyse n'a pas pu aboutir</h2>
        <p>{failureReason}</p>
        <div className="onboarding-failed__actions">
          <button className="connection-button connection-button--secondary" onClick={() => setStep("url")} type="button">Réessayer avec une autre URL</button>
          <button className="connection-button" onClick={() => void startManual()} type="button">Continuer manuellement</button>
        </div>
      </div>
    </GlassCard> : null}

    {step === "review" ? <div className="onboarding-review">
      <GlassCard className="onboarding-review__card">
        <div className="onboarding-review__card-head">
          <p className="onboarding-overlay__step-count">Étape {activeSection + 1} sur {BUSINESS_CONTEXT_SECTION_TITLES.length}</p>
          <button className="connection-button connection-button--quiet" onClick={() => setStep("url")} type="button">Analyser un autre site</button>
        </div>
        <p className="onboarding-review__intro-text">Vérifiez et corrigez ces informations si besoin — Talvia distingue ce qui est constaté sur votre site, ce qui est déduit, et ce qui est une suggestion à valider.</p>
        <BusinessContextForm activeSection={activeSection} onChange={setEditable} record={record} value={editable} />
        <div className="onboarding-review__actions">
          {activeSection > 0 ? <button className="connection-button connection-button--secondary" onClick={() => setActiveSection((current) => current - 1)} type="button">Précédent</button> : <span />}
          {activeSection < BUSINESS_CONTEXT_SECTION_TITLES.length - 1
            ? <button className="connection-button" onClick={() => setActiveSection((current) => current + 1)} type="button">Continuer<LuArrowRight aria-hidden="true" /></button>
            : <button className="connection-button" disabled={saving} onClick={() => void save()} type="button">{saving ? "Enregistrement…" : "Valider ce profil"}</button>}
        </div>
      </GlassCard>
    </div> : null}
  </div>;
}

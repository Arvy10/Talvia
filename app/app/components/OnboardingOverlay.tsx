"use client";

import { useEffect, useRef, useState } from "react";
import { LuArrowRight, LuGlobe, LuTriangleAlert } from "react-icons/lu";

import type { BusinessContextRecord } from "../../lib/business-context/business-context-service";
import { businessContextToSummaryData, manualEntryToEditInput } from "./onboarding/mapping";
import { ManualEntryFlow } from "./onboarding/ManualEntryFlow";
import { SummaryCard } from "./onboarding/SummaryCard";

type SubStep = "choice" | "url-input" | "analyzing" | "url-failed" | "url-summary" | "manual" | "saving";

const PROGRESS_STAGES = [
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

export function OnboardingOverlay({
  existingRecord,
  onComplete,
  onDefer,
}: {
  existingRecord: BusinessContextRecord | null;
  onComplete: () => void;
  onDefer: () => void;
}) {
  const [step, setStep] = useState<SubStep>("choice");
  const [website, setWebsite] = useState(existingRecord?.website ?? "");
  const [progressStage, setProgressStage] = useState(0);
  const [failureReason, setFailureReason] = useState("");
  const [analyzedRecord, setAnalyzedRecord] = useState<BusinessContextRecord | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (progressTimer.current) clearInterval(progressTimer.current);
  }, []);

  const ensureManualContext = async () => {
    if (existingRecord) return;
    await fetch("/api/business-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manual: true }),
    });
  };

  const startManualFlow = async () => {
    await ensureManualContext();
    setStep("manual");
  };

  const runAnalysis = async () => {
    if (!website.trim()) return;
    setStep("analyzing");
    setProgressStage(0);
    progressTimer.current = setInterval(() => setProgressStage((current) => (current + 1) % PROGRESS_STAGES.length), 1800);

    let response: Response;
    try {
      response = await fetch("/api/business-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ website: website.trim() }),
        signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      });
    } catch (error) {
      if (progressTimer.current) clearInterval(progressTimer.current);
      setFailureReason(error instanceof DOMException && error.name === "TimeoutError" ? "L'analyse a pris trop de temps et a été interrompue." : "Impossible de contacter le serveur.");
      setStep("url-failed");
      return;
    }
    if (progressTimer.current) clearInterval(progressTimer.current);

    if (!response.ok) {
      const body = await readJson<{ error?: string }>(response).catch(() => ({ error: undefined }));
      setFailureReason(body.error ?? "Une erreur est survenue pendant l'analyse.");
      setStep("url-failed");
      return;
    }

    const { businessContext } = await readJson<{ businessContext: BusinessContextRecord }>(response);
    if (businessContext.status === "ready") {
      setAnalyzedRecord(businessContext);
      setStep("url-summary");
      return;
    }
    setFailureReason(businessContext.errorReason ?? "L'analyse n'a pas abouti.");
    setStep("url-failed");
  };

  const finishManualFlow = async (values: Parameters<typeof manualEntryToEditInput>[0]) => {
    setStep("saving");
    await fetch("/api/business-context", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(manualEntryToEditInput(values)),
    });
    onComplete();
  };

  return <div className="onboarding-overlay-backdrop">
    <div aria-label="Configurer le profil de votre entreprise" aria-modal="true" className="onboarding-overlay" role="dialog">
      <button className="onboarding-overlay__defer" onClick={onDefer} type="button">Plus tard</button>

      {step === "choice" ? <div className="onboarding-overlay__panel">
        <span className="onboarding-overlay__icon" aria-hidden="true"><LuGlobe /></span>
        <h2>Aidez-nous à mieux vous connaître</h2>
        <p>Talvia utilise le profil de votre entreprise pour préparer un contexte utile à vos échanges commerciaux.</p>
        <div className="onboarding-overlay__choices">
          <button className="connection-button" onClick={() => setStep("url-input")} type="button">J'ai un site web<LuArrowRight aria-hidden="true" /></button>
          <button className="connection-button connection-button--secondary" onClick={() => void startManualFlow()} type="button">Je préfère répondre à quelques questions</button>
        </div>
      </div> : null}

      {step === "url-input" ? <div className="onboarding-overlay__panel">
        <h2>Quelle est l'adresse de votre site ?</h2>
        <p>Talvia va lire votre page d'accueil et quelques pages clés pour préparer votre profil.</p>
        <form onSubmit={(event) => { event.preventDefault(); void runAnalysis(); }}>
          <input inputMode="url" onChange={(event) => setWebsite(event.target.value)} placeholder="https://votre-site.com" required type="url" value={website} />
          <button className="connection-button" type="submit">Analyser<LuArrowRight aria-hidden="true" /></button>
        </form>
      </div> : null}

      {step === "analyzing" ? <div className="onboarding-overlay__panel">
        <h2>Talvia analyse votre entreprise</h2>
        <p aria-live="polite" className="onboarding-progress__current"><span aria-hidden="true" className="onboarding-progress__spinner" />{PROGRESS_STAGES[progressStage]}</p>
      </div> : null}

      {step === "url-failed" ? <div className="onboarding-overlay__panel">
        <span className="onboarding-overlay__icon" aria-hidden="true"><LuTriangleAlert /></span>
        <h2>L'analyse n'a pas pu aboutir</h2>
        <p>{failureReason}</p>
        <div className="onboarding-overlay__choices">
          <button className="connection-button connection-button--secondary" onClick={() => setStep("url-input")} type="button">Réessayer avec une autre URL</button>
          <button className="connection-button" onClick={() => void startManualFlow()} type="button">Répondre à quelques questions à la place</button>
        </div>
      </div> : null}

      {step === "url-summary" && analyzedRecord ? <div className="onboarding-overlay__panel">
        <SummaryCard
          actions={<>
            <a className="connection-button connection-button--secondary" href="/app/settings">Voir les détails</a>
            <button className="connection-button" onClick={onComplete} type="button">Tout est correct</button>
          </>}
          data={businessContextToSummaryData(analyzedRecord)}
        />
      </div> : null}

      {step === "manual" ? <ManualEntryFlow
        cancelLabel="Retour"
        initial={{ companyName: existingRecord?.companyName ?? "", businessDescription: existingRecord?.businessDescription ?? "" }}
        onCancel={() => setStep("choice")}
        onSubmit={(values) => void finishManualFlow(values)}
      /> : null}

      {step === "saving" ? <div className="onboarding-overlay__panel"><p className="onboarding-loading">Enregistrement…</p></div> : null}
    </div>
  </div>;
}

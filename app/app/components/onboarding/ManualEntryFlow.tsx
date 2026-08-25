"use client";

import { useState } from "react";
import { LuArrowRight } from "react-icons/lu";

import { ChoiceChips } from "./ChoiceChips";
import { GeographyPicker } from "./GeographyPicker";
import { COMPANY_SIZE_OPTIONS, COMPANY_TYPE_OPTIONS, CUSTOMER_TYPE_OPTIONS, ROLE_OPTIONS } from "./presets";
import { SummaryCard, type SummaryData } from "./SummaryCard";
import { TagComboBox } from "./TagComboBox";
import { TagInput } from "./TagInput";
import { IndustrySelect } from "../IndustrySelect";
import { INDUSTRY_OPTIONS } from "../industries";

export type ManualEntryValues = {
  companyName: string;
  businessDescription: string;
  industry: string;
  offers: string[];
  customerTypeLabel: (typeof CUSTOMER_TYPE_OPTIONS)[number] | "";
  targetCompanyTypes: string[];
  companySizes: string[];
  targetRoles: string[];
  allIndustries: boolean;
  targetIndustries: string[];
  geographies: string[];
  mainProblem: string;
};

export function emptyManualEntryValues(): ManualEntryValues {
  return {
    companyName: "",
    businessDescription: "",
    industry: "",
    offers: [],
    customerTypeLabel: "",
    targetCompanyTypes: [],
    companySizes: [],
    targetRoles: [],
    allIndustries: false,
    targetIndustries: [],
    geographies: [],
    mainProblem: "",
  };
}

function toSummaryData(values: ManualEntryValues): SummaryData {
  const targetParts = [...values.targetCompanyTypes, ...values.companySizes].filter(Boolean);
  return {
    companyName: values.companyName,
    industry: values.industry,
    offers: values.offers,
    targetLabel: targetParts.length > 0 ? targetParts.join(" · ") : values.customerTypeLabel,
    geographyLabel: values.geographies.join(" · "),
    mainProblem: values.mainProblem,
  };
}

type StepId = "identity" | "offer" | "target" | "angle";
const STEP_ORDER: StepId[] = ["identity", "offer", "target", "angle"];
const STEP_LABELS: Record<StepId, string> = { identity: "Identité", offer: "Offre", target: "Cible", angle: "Angle commercial" };

function Stepper({ current }: { current: StepId }) {
  return <div className="onboarding-stepper" aria-hidden="true">
    {STEP_ORDER.map((step, index) => <span className={step === current ? "onboarding-stepper__item is-active" : "onboarding-stepper__item"} key={step}>
      {STEP_LABELS[step]}
      {index < STEP_ORDER.length - 1 ? <LuArrowRight aria-hidden="true" /> : null}
    </span>)}
  </div>;
}

const isB2bRelevant = (customerTypeLabel: ManualEntryValues["customerTypeLabel"]) => customerTypeLabel === "Entreprises" || customerTypeLabel === "Les deux";

// The whole simplified manual-onboarding experience: 4 short steps (each
// asking as little as possible, with progressive disclosure inside
// "Cible") plus a recap. Presentational content only — the host component
// (overlay or full page) owns the network calls and decides what "Plus
// tard" / final submit actually do.
export function ManualEntryFlow({
  initial,
  onCancel,
  cancelLabel = "Plus tard",
  onSubmit,
  submitting = false,
}: {
  initial?: Partial<ManualEntryValues>;
  onCancel: () => void;
  cancelLabel?: string;
  onSubmit: (values: ManualEntryValues) => void;
  submitting?: boolean;
}) {
  const [values, setValues] = useState<ManualEntryValues>({ ...emptyManualEntryValues(), ...initial });
  const [step, setStep] = useState<StepId | "summary">("identity");

  const set = <K extends keyof ManualEntryValues>(key: K) => (next: ManualEntryValues[K]) => setValues((current) => ({ ...current, [key]: next }));

  const canContinue =
    step === "identity" ? values.companyName.trim().length > 0 && values.businessDescription.trim().length > 0 :
    step === "offer" ? values.offers.length > 0 :
    step === "target" ? values.customerTypeLabel !== "" :
    true;

  const stepIndex = step === "summary" ? -1 : STEP_ORDER.indexOf(step);

  const goNext = () => {
    if (step === "summary") return;
    const nextIndex = stepIndex + 1;
    setStep(nextIndex < STEP_ORDER.length ? STEP_ORDER[nextIndex]! : "summary");
  };
  const goBack = () => {
    if (step === "summary") { setStep("angle"); return; }
    if (stepIndex > 0) setStep(STEP_ORDER[stepIndex - 1]!);
  };

  if (step === "summary") {
    return <div className="onboarding-overlay__panel">
      <SummaryCard
        actions={<>
          <button className="connection-button connection-button--secondary" onClick={goBack} type="button">Modifier</button>
          <button className="connection-button" disabled={submitting} onClick={() => onSubmit(values)} type="button">{submitting ? "Enregistrement…" : "Tout est correct"}</button>
        </>}
        data={toSummaryData(values)}
      />
    </div>;
  }

  return <div className="onboarding-overlay__panel">
    <Stepper current={step} />

    {step === "identity" ? <>
      <h2>Votre entreprise</h2>
      <label className="onboarding-overlay__field"><span>Comment s'appelle votre entreprise ?</span><input onChange={(event) => set("companyName")(event.target.value)} placeholder="Ex : Fayluméa" value={values.companyName} /></label>
      <label className="onboarding-overlay__field"><span>Que fait votre entreprise ?</span><textarea onChange={(event) => set("businessDescription")(event.target.value)} placeholder="Ex : Nous créons des sites internet et des systèmes d'automatisation pour les entreprises." rows={3} value={values.businessDescription} /></label>
      <div className="onboarding-overlay__field"><span>Secteur (optionnel)</span><IndustrySelect onChange={set("industry")} value={values.industry} /></div>
    </> : null}

    {step === "offer" ? <>
      <h2>Que vendez-vous ?</h2>
      <div className="onboarding-overlay__field">
        <span>Quels sont vos principaux produits ou services ?</span>
        <TagInput max={5} onChange={set("offers")} placeholder="Ex : Création de sites web" value={values.offers} />
      </div>
    </> : null}

    {step === "target" ? <>
      <h2>À qui vendez-vous ?</h2>
      <div className="onboarding-overlay__field">
        <span>Vous vendez principalement à :</span>
        <ChoiceChips onChange={(next) => set("customerTypeLabel")(next as ManualEntryValues["customerTypeLabel"])} options={[...CUSTOMER_TYPE_OPTIONS]} value={values.customerTypeLabel} />
      </div>

      {values.customerTypeLabel !== "" ? <>
        {isB2bRelevant(values.customerTypeLabel) ? <>
          <div className="onboarding-overlay__field">
            <span>Quel type d'entreprise ciblez-vous principalement ? (optionnel)</span>
            <TagComboBox onChange={set("targetCompanyTypes")} options={COMPANY_TYPE_OPTIONS} placeholder="Rechercher ou préciser…" value={values.targetCompanyTypes} />
          </div>
          <div className="onboarding-overlay__field">
            <span>Taille de vos clients (optionnel)</span>
            <ChoiceChips multiple onChange={(next) => set("companySizes")(next as string[])} options={COMPANY_SIZE_OPTIONS} value={values.companySizes} />
          </div>
          <div className="onboarding-overlay__field">
            <span>Avec qui échangez-vous généralement ? (optionnel)</span>
            <TagComboBox onChange={set("targetRoles")} options={ROLE_OPTIONS} placeholder="Rechercher ou préciser…" value={values.targetRoles} />
          </div>
          <div className="onboarding-overlay__field">
            <span>Certains secteurs en particulier ? (optionnel)</span>
            <button className={values.allIndustries ? "choice-chip is-selected" : "choice-chip"} onClick={() => setValues((current) => ({ ...current, allIndustries: !current.allIndustries, targetIndustries: [] }))} type="button">Tous secteurs</button>
            {!values.allIndustries ? <TagComboBox onChange={set("targetIndustries")} options={INDUSTRY_OPTIONS} placeholder="Rechercher un secteur…" value={values.targetIndustries} /> : null}
          </div>
        </> : null}
        <div className="onboarding-overlay__field">
          <span>Où trouvez-vous principalement vos clients ? (optionnel)</span>
          <GeographyPicker onChange={set("geographies")} value={values.geographies} />
        </div>
      </> : null}
    </> : null}

    {step === "angle" ? <>
      <h2>Pourquoi vos clients viennent-ils vers vous ?</h2>
      <label className="onboarding-overlay__field">
        <span>Quel problème les aidez-vous principalement à résoudre ? (optionnel)</span>
        <textarea onChange={(event) => set("mainProblem")(event.target.value)} placeholder="Ex : Ils ont du mal à trouver des clients grâce à leur présence en ligne." rows={3} value={values.mainProblem} />
      </label>
    </> : null}

    <div className="onboarding-overlay__nav">
      {stepIndex > 0 ? <button className="connection-button connection-button--secondary" onClick={goBack} type="button">Retour</button> : <button className="connection-button connection-button--secondary" onClick={onCancel} type="button">{cancelLabel}</button>}
      <button className="connection-button" disabled={!canContinue} onClick={goNext} type="button">Continuer<LuArrowRight aria-hidden="true" /></button>
    </div>
  </div>;
}

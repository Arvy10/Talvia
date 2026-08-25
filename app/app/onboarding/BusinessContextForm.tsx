"use client";

import type { BusinessContextEditInput, BusinessContextRecord } from "../../lib/business-context/business-context-service";
import type { Provenance } from "../../lib/business-context/types";
import { CountryMultiSelect } from "../components/CountryMultiSelect";
import { IndustrySelect } from "../components/IndustrySelect";

const provenanceLabels: Record<Provenance, string> = { fact: "Constaté", inference: "Déduit", suggestion: "Suggestion", user_provided: "Renseigné par vous" };

function ProvenanceBadge({ provenance, confidence }: { provenance: Provenance; confidence: number }) {
  return <span
    className={`provenance-badge provenance-badge--${provenance}`}
    title={`Confiance estimée : ${Math.round(confidence * 100)}%`}
  >
    {provenanceLabels[provenance]}
  </span>;
}

export type EditableBusinessContext = {
  companyName: string;
  businessDescription: string;
  primaryLanguage: string;
  services: string;
  products: string;
  keywords: string;
  industry: string;
  valueProposition: string;
  targetCustomers: string;
  targetIndustries: string;
  targetCompanySizes: string;
  targetRoles: string;
  geographies: string;
  painPoints: string;
  salesAngles: string;
};

const listToLines = (list: string[] | null | undefined) => (list ?? []).join("\n");
const linesToList = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);

export function toEditable(record: BusinessContextRecord | null): EditableBusinessContext {
  return {
    companyName: record?.companyName ?? "",
    businessDescription: record?.businessDescription ?? "",
    primaryLanguage: record?.primaryLanguage ?? "fr",
    services: listToLines(record?.services),
    products: listToLines(record?.products),
    keywords: listToLines(record?.keywords),
    industry: record?.industry?.value ?? "",
    valueProposition: record?.valueProposition?.value ?? "",
    targetCustomers: listToLines(record?.targetCustomers?.value),
    targetIndustries: listToLines(record?.targetIndustries?.value),
    targetCompanySizes: listToLines(record?.targetCompanySizes?.value),
    targetRoles: listToLines(record?.targetRoles?.value),
    geographies: listToLines(record?.geographies?.value),
    painPoints: listToLines(record?.painPoints?.value),
    salesAngles: listToLines(record?.salesAngles?.value),
  };
}

export function toEditInput(editable: EditableBusinessContext): BusinessContextEditInput {
  return {
    companyName: editable.companyName.trim(),
    businessDescription: editable.businessDescription.trim(),
    primaryLanguage: editable.primaryLanguage.trim() || "fr",
    services: linesToList(editable.services),
    products: linesToList(editable.products),
    keywords: linesToList(editable.keywords),
    industry: editable.industry.trim(),
    valueProposition: editable.valueProposition.trim(),
    targetCustomers: linesToList(editable.targetCustomers),
    targetIndustries: linesToList(editable.targetIndustries),
    targetCompanySizes: linesToList(editable.targetCompanySizes),
    targetRoles: linesToList(editable.targetRoles),
    geographies: linesToList(editable.geographies),
    painPoints: linesToList(editable.painPoints),
    salesAngles: linesToList(editable.salesAngles),
  };
}

type Field = { key: keyof EditableBusinessContext; label: string; hint?: string; multiline?: boolean; list?: boolean };
type Badge = { provenance: Provenance; confidence: number } | null;

function FieldLabel({ label, badge }: { label: string; badge?: Badge }) {
  return <span className="bc-field__label">
    {label}
    {badge ? <ProvenanceBadge confidence={badge.confidence} provenance={badge.provenance} /> : null}
  </span>;
}

function FieldRow({
  field,
  value,
  onChange,
  badge,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
  badge?: Badge;
}) {
  return <label className="bc-field">
    <FieldLabel badge={badge} label={field.label} />
    {field.hint ? <small>{field.hint}</small> : null}
    {field.multiline || field.list ? (
      <textarea
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.list ? "Un élément par ligne" : undefined}
        rows={field.list ? 4 : 3}
        value={value}
      />
    ) : (
      <input onChange={(event) => onChange(event.target.value)} value={value} />
    )}
  </label>;
}

// One section = one card in the review flow — OnboardingClient shows a
// single section at a time with Précédent/Suivant instead of one long
// scrolling page, so revisiting an existing profile feels the same as
// first-time onboarding.
export const BUSINESS_CONTEXT_SECTION_TITLES = ["Identité", "Offre", "Cible", "Angle commercial"] as const;

export function BusinessContextForm({
  value,
  record,
  onChange,
  activeSection,
}: {
  value: EditableBusinessContext;
  record: BusinessContextRecord | null;
  onChange: (next: EditableBusinessContext) => void;
  activeSection: number;
}) {
  const set = <K extends keyof EditableBusinessContext>(key: K) => (fieldValue: string) => onChange({ ...value, [key]: fieldValue });

  return <div className="bc-form">
    {activeSection === 0 ? <section className="bc-form__section">
      <h3>Identité</h3>
      <FieldRow field={{ key: "companyName", label: "Nom de l'entreprise" }} onChange={set("companyName")} value={value.companyName} />
      <FieldRow field={{ key: "businessDescription", label: "Description de l'activité", multiline: true }} onChange={set("businessDescription")} value={value.businessDescription} />
      <div className="bc-field">
        <FieldLabel badge={record?.industry ?? null} label="Secteur" />
        <IndustrySelect onChange={set("industry")} value={value.industry} />
      </div>
      <FieldRow field={{ key: "valueProposition", label: "Proposition de valeur", multiline: true }} badge={record?.valueProposition ?? null} onChange={set("valueProposition")} value={value.valueProposition} />
    </section> : null}

    {activeSection === 1 ? <section className="bc-form__section">
      <h3>Offre</h3>
      <FieldRow field={{ key: "services", label: "Services", list: true }} onChange={set("services")} value={value.services} />
      <FieldRow field={{ key: "products", label: "Produits", list: true }} onChange={set("products")} value={value.products} />
      <FieldRow field={{ key: "keywords", label: "Mots-clés", list: true }} onChange={set("keywords")} value={value.keywords} />
    </section> : null}

    {activeSection === 2 ? <section className="bc-form__section">
      <h3>Cible</h3>
      <FieldRow field={{ key: "targetCustomers", label: "Types de clients", list: true }} badge={record?.targetCustomers ?? null} onChange={set("targetCustomers")} value={value.targetCustomers} />
      <FieldRow field={{ key: "targetIndustries", label: "Secteurs visés", list: true }} badge={record?.targetIndustries ?? null} onChange={set("targetIndustries")} value={value.targetIndustries} />
      <FieldRow field={{ key: "targetCompanySizes", label: "Taille d'entreprise visée", list: true }} badge={record?.targetCompanySizes ?? null} onChange={set("targetCompanySizes")} value={value.targetCompanySizes} />
      <FieldRow field={{ key: "targetRoles", label: "Interlocuteurs visés", list: true }} badge={record?.targetRoles ?? null} onChange={set("targetRoles")} value={value.targetRoles} />
      <div className="bc-field">
        <FieldLabel badge={record?.geographies ?? null} label="Zones géographiques" />
        <CountryMultiSelect onChange={(names) => set("geographies")(names.join("\n"))} value={linesToList(value.geographies)} />
      </div>
    </section> : null}

    {activeSection === 3 ? <section className="bc-form__section">
      <h3>Angle commercial <span className="bc-form__section-note">Recommandations à valider, pas des constats</span></h3>
      <FieldRow field={{ key: "painPoints", label: "Problèmes résolus", list: true }} badge={record?.painPoints ?? null} onChange={set("painPoints")} value={value.painPoints} />
      <FieldRow field={{ key: "salesAngles", label: "Angles d'approche suggérés", list: true }} badge={record?.salesAngles ?? null} onChange={set("salesAngles")} value={value.salesAngles} />
    </section> : null}
  </div>;
}

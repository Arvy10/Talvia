import type { BusinessContextEditInput, BusinessContextRecord } from "../../../lib/business-context/business-context-service";
import type { ManualEntryValues } from "./ManualEntryFlow";
import type { SummaryData } from "./SummaryCard";

const CUSTOMER_TYPE_TO_VALUE: Record<ManualEntryValues["customerTypeLabel"], BusinessContextEditInput["customerType"] | undefined> = {
  "": undefined,
  "Entreprises": "b2b",
  "Particuliers": "b2c",
  "Les deux": "both",
};

const arrayOrUndefined = (list: string[]): string[] | undefined => (list.length > 0 ? list : undefined);
const textOrUndefined = (text: string): string | undefined => (text.trim() ? text.trim() : undefined);

// Maps the simplified onboarding answers onto the existing edit-input
// shape — "type d'entreprise ciblée" lands on targetCustomers (the closest
// existing field, already labeled "types de clients" in the detailed
// editor), and the single "problème principal" becomes a one-item
// painPoints array rather than inventing a new column for it.
//
// A field left empty because it was OPTIONAL and skipped must come out as
// `undefined`, not `[]`/`""` — updateActiveBusinessContext treats any
// defined value as a real human answer and marks it manuallyEditedFields,
// which permanently blocks that field from ever being filled by AI
// enrichment or reanalysis later. Skipping a question must leave the door
// open, not lock it shut on an empty value.
export function manualEntryToEditInput(values: ManualEntryValues): BusinessContextEditInput {
  return {
    companyName: textOrUndefined(values.companyName),
    businessDescription: textOrUndefined(values.businessDescription),
    industry: textOrUndefined(values.industry),
    services: arrayOrUndefined(values.offers),
    customerType: CUSTOMER_TYPE_TO_VALUE[values.customerTypeLabel],
    targetCustomers: arrayOrUndefined(values.targetCompanyTypes),
    targetCompanySizes: arrayOrUndefined(values.companySizes),
    targetRoles: arrayOrUndefined(values.targetRoles),
    targetIndustries: values.allIndustries ? [] : arrayOrUndefined(values.targetIndustries),
    geographies: arrayOrUndefined(values.geographies),
    painPoints: textOrUndefined(values.mainProblem) ? [values.mainProblem.trim()] : undefined,
  };
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = { b2b: "Entreprises", b2c: "Particuliers", both: "Entreprises et particuliers" };

// Same lightweight recap for a freshly AI-analyzed record — point 27 of the
// brief: don't dump 15 detected properties on the user right after
// analysis, show the same short summary as the manual flow gets.
export function businessContextToSummaryData(record: BusinessContextRecord): SummaryData {
  const targetParts = [...(record.targetCustomers?.value ?? []), ...(record.targetCompanySizes?.value ?? [])];
  const targetLabel = targetParts.length > 0 ? targetParts.join(" · ") : (record.customerType ? CUSTOMER_TYPE_LABELS[record.customerType.value] ?? "" : "");
  return {
    companyName: record.companyName ?? "",
    industry: record.industry?.value ?? "",
    offers: record.services ?? [],
    targetLabel,
    geographyLabel: (record.geographies?.value ?? []).join(" · "),
    mainProblem: (record.painPoints?.value ?? [])[0] ?? "",
  };
}

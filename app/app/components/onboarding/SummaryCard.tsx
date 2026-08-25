"use client";

import type { ReactNode } from "react";

export type SummaryData = {
  companyName: string;
  industry: string;
  offers: string[];
  targetLabel: string;
  geographyLabel: string;
  mainProblem: string;
};

// Shared recap shown after BOTH the manual flow and a successful URL
// analysis — the same lightweight "here's what Talvia understood" moment
// either way, never a wall of every detected field.
export function SummaryCard({ data, actions }: { data: SummaryData; actions: ReactNode }) {
  return <div className="onboarding-summary">
    <h2>{data.companyName || "Votre entreprise"}</h2>
    {data.industry ? <p className="onboarding-summary__industry">{data.industry}</p> : null}
    {data.offers.length > 0 ? <p className="onboarding-summary__offers">{data.offers.join(" · ")}</p> : null}
    {data.targetLabel ? <div className="onboarding-summary__row"><span>Vend principalement à</span><strong>{data.targetLabel}</strong></div> : null}
    {data.geographyLabel ? <div className="onboarding-summary__row"><span>Zone</span><strong>{data.geographyLabel}</strong></div> : null}
    {data.mainProblem ? <div className="onboarding-summary__row"><span>Problème principal</span><strong>{data.mainProblem}</strong></div> : null}
    <div className="onboarding-summary__actions">{actions}</div>
  </div>;
}

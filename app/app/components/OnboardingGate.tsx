"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { BusinessContextRecord } from "../../lib/business-context/business-context-service";
import { OnboardingOverlay } from "./OnboardingOverlay";

const DISMISS_KEY = "talvia:onboarding-deferred";

// Shown once per browser session (sessionStorage, not localStorage) until
// the Business Context is ready — closing the tab/browser and coming back
// later counts as a new session, so the nudge reappears rather than being
// silenced forever. Never blocks navigation: it's an overlay, not a route
// guard, so a user who ignores it can still use the rest of the app.
export function OnboardingGate({ pathname }: { pathname: string }) {
  const [record, setRecord] = useState<BusinessContextRecord | null | undefined>(undefined);
  const [dismissed, setDismissed] = useState(true);

  const suppressed = pathname.startsWith("/app/onboarding");

  useEffect(() => {
    if (suppressed) return;
    setDismissed(typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "true");
    void fetch("/api/business-context").then((response) => (response.ok ? response.json() : null)).then((data: { businessContext: BusinessContextRecord | null } | null) => {
      setRecord(data?.businessContext ?? null);
    });
  }, [suppressed]);

  if (suppressed || dismissed || record === undefined || record?.status === "ready" || typeof document === "undefined") {
    return null;
  }

  const defer = () => {
    window.sessionStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return createPortal(
    <OnboardingOverlay existingRecord={record} onComplete={() => setDismissed(true)} onDefer={defer} />,
    document.body,
  );
}

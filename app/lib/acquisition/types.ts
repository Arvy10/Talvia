export type BetaLeadStatus = "WAITLIST" | "INVITED" | "ACTIVATED" | "CUSTOMER" | "UNSUBSCRIBED";

export type LeadRegistrationInput = {
  email: unknown;
  firstName?: unknown;
  role?: unknown;
  source?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  utmTerm?: unknown;
  landingUrl?: unknown;
};

export type NormalizedLeadInput = {
  email: string;
  firstName: string | null;
  role: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingUrl: string | null;
};

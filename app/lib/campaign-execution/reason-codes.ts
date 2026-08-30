// The diagnostic vocabulary for "why didn't this participant get contacted".
// Stored on campaign_participants.last_error_code (per-participant) and
// returned in an EngineRunSummary (campaign-wide) — never necessarily shown
// to the end user, but always queryable when a campaign silently sends
// nothing (docs/product/ARCHITECTURE.md §9 — never fabricate success without
// an explanation for its absence).
export type ReasonCode =
  | "NO_LINKEDIN_CONNECTION"
  | "INVALID_IDENTITY"
  | "NOT_ELIGIBLE"
  | "WAITING_FOR_ACCEPTANCE"
  | "SCHEDULE_NOT_DUE"
  | "ALREADY_SENT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_ERROR"
  | "CAMPAIGN_PAUSED"
  | "PARTICIPANT_REPLIED"
  | "NO_STEP_CONFIGURED"
  | "DAILY_LIMIT_REACHED"
  // Phase 3 — personalization pipeline (docs spec §22). MESSAGE_ALREADY_SENT
  // is deliberately not its own code: ALREADY_SENT above already covers it.
  | "NO_PERSONALIZATION_DATA"
  | "AI_GENERATION_FAILED"
  | "MESSAGE_NOT_GENERATED"
  | "MESSAGE_NOT_APPROVED";

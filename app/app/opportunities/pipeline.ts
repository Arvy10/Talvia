import type { OpportunityStage } from "../state/types";

export const PIPELINE_STAGES = [
  ["new", "Nouveau"],
  ["qualified", "Qualifié"],
  ["proposal", "Proposition"],
  ["negotiation", "Négociation"],
  ["won", "Gagné"],
] as const;

export type PipelineStage = OpportunityStage;

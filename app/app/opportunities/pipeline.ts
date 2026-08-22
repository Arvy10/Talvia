export const PIPELINE_STAGES = [
  ["new", "Nouveau"],
  ["qualified", "Qualifié"],
  ["proposal", "Proposition"],
  ["negotiation", "Négociation"],
  ["won", "Gagné"],
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number][0];

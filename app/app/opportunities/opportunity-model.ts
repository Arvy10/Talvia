import type { Opportunity, OpportunityStage, SandboxActivity } from "../state/types";

export const OPEN_STAGES: OpportunityStage[] = ["new", "qualified", "proposal", "negotiation"];

export function formatOpportunityValue(opportunity: Opportunity): string | null {
  if (opportunity.value === undefined || !opportunity.currency) return null;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: opportunity.currency, maximumFractionDigits: 0 }).format(opportunity.value);
}

export function getOpportunityLastActivity(opportunity: Opportunity, activities: SandboxActivity[]): string | undefined {
  return activities.filter((item) => item.opportunityId === opportunity.id).map((item) => item.createdAt).sort().at(-1) ?? opportunity.updatedAt ?? opportunity.createdAt;
}

export function isOpportunityStale(opportunity: Opportunity, activities: SandboxActivity[], now = Date.now()): boolean {
  const latest = getOpportunityLastActivity(opportunity, activities);
  return OPEN_STAGES.includes(opportunity.stage) && !!latest && now - new Date(latest).getTime() >= 7 * 86_400_000;
}

export function isOpportunityOverdue(opportunity: Opportunity, now = Date.now()): boolean {
  return !!opportunity.nextActionAt && !opportunity.nextActionCompletedAt && new Date(opportunity.nextActionAt).getTime() < now;
}

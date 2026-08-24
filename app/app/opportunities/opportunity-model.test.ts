import { describe, expect, it } from "vitest";
import { formatOpportunityValue, getOpportunityLastActivity, isOpportunityOverdue, isOpportunityStale } from "./opportunity-model";
import type { Opportunity, SandboxActivity } from "../state/types";

const opportunity: Opportunity = { id: "o1", title: "Refonte site web", stage: "qualified", contactId: "c1", value: 1500, currency: "EUR", createdAt: "2026-08-01T00:00:00.000Z" };
const activities: SandboxActivity[] = [{ id: "a1", opportunityId: "o1", label: "Étape modifiée", createdAt: "2026-08-10T00:00:00.000Z" }];

describe("opportunity model", () => {
  it("formats optional values without inventing a conversion", () => expect(formatOpportunityValue(opportunity)).toContain("1 500"));
  it("uses the shared activity timeline as last activity", () => expect(getOpportunityLastActivity(opportunity, activities)).toBe("2026-08-10T00:00:00.000Z"));
  it("detects stale open opportunities", () => expect(isOpportunityStale(opportunity, activities, new Date("2026-08-20").getTime())).toBe(true));
  it("detects overdue unfinished next actions", () => expect(isOpportunityOverdue({ ...opportunity, nextActionAt: "2026-08-11T00:00:00.000Z" }, new Date("2026-08-12").getTime())).toBe(true));
  it("does not flag completed next actions", () => expect(isOpportunityOverdue({ ...opportunity, nextActionAt: "2026-08-11T00:00:00.000Z", nextActionCompletedAt: "2026-08-11T12:00:00.000Z" }, new Date("2026-08-12").getTime())).toBe(false));
});

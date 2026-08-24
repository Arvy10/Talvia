import type { Automation, ChannelId, SandboxActivity, SandboxState } from "../state/types";

export type AutomationEvent = { type: "message_received" | "campaign_reply" | "opportunity_proposal" | "opportunity_created" | "contact_added"; channel?: ChannelId; contactId?: string; conversationId?: string; campaignId?: string; opportunityId?: string };

const labels: Record<AutomationEvent["type"], string> = { message_received: "Message reçu", campaign_reply: "Réponse de campagne", opportunity_proposal: "Opportunité passée à Proposition", opportunity_created: "Opportunité créée", contact_added: "Contact ajouté" };

export function runAutomations(state: SandboxState, event: AutomationEvent): SandboxState {
  let next = state;
  for (const automation of state.automations) {
    if (!automation.enabled || automation.event !== event.type || (automation.channel && event.channel && automation.channel !== event.channel)) continue;
    const now = new Date().toISOString(); let result: "success" | "skipped" | "failed" = "success"; let actionLabel = automation.action;
    if (automation.action === "stop_campaign" && event.campaignId && event.contactId) { const campaign = (next.campaigns ?? []).find((item) => item.id === event.campaignId); if (campaign) next = { ...next, campaigns: (next.campaigns ?? []).map((item) => item.id === campaign.id ? { ...item, participantStatuses: { ...item.participantStatuses, [event.contactId!]: "stopped" } } : item) }; else result = "skipped"; }
    else if (automation.action === "create_follow_up" && event.opportunityId) { next = { ...next, opportunities: next.opportunities.map((item) => item.id === event.opportunityId ? { ...item, nextAction: "Relancer la proposition", nextActionAt: new Date(Date.now() + 3 * 86400000).toISOString(), updatedAt: now } : item) }; }
    else if (automation.action === "mark_priority" && event.conversationId) { next = { ...next, conversations: (next.conversations ?? []).map((item) => item.id === event.conversationId ? { ...item, unread: true } : item) }; }
    else if (automation.action === "prepare_draft") { actionLabel = automation.replyMode === "auto" ? "Simulation uniquement — aucun message réel envoyé" : "Brouillon sandbox préparé"; }
    else result = "skipped";
    const activity: SandboxActivity = { id: crypto.randomUUID(), label: `${automation.name} · ${result === "success" ? actionLabel : "Ignorée"}`, createdAt: now, contactId: event.contactId, opportunityId: event.opportunityId, kind: "message" };
    next = { ...next, automations: next.automations.map((item) => item.id === automation.id ? { ...item, lastRunAt: now, lastResult: result } : item), activities: [...(next.activities ?? []), activity] };
  }
  return next;
}
export function testEventFor(automation: Automation): AutomationEvent { return { type: automation.event ?? "message_received", channel: automation.channel, contactId: "sandbox-contact", conversationId: "sandbox-conversation", campaignId: "sandbox-campaign", opportunityId: "sandbox-opportunity" }; }
export function describeAutomation(automation: Automation): string { return `Quand ${labels[automation.event ?? "message_received"]} → Alors ${automation.action}`; }

import type { ChannelId } from "../state/types";
export type AutomationTemplate = { id: string; title: string; description: string; trigger: string; channel: ChannelId; action: string; event?: "message_received" | "campaign_reply" | "opportunity_proposal"; };
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  { id: "campaign-reply", title: "Arrêter une campagne après une réponse", description: "Automatisation : lorsqu’un contact répond, sa séquence s’arrête pour ce contact.", trigger: "Un contact répond à une campagne", channel: "linkedin", action: "stop_campaign", event: "campaign_reply" },
  { id: "opportunity-follow-up", title: "Relancer une proposition", description: "Ajoute une prochaine action après le passage à Proposition.", trigger: "Une opportunité passe à Proposition", channel: "gmail", action: "create_follow_up", event: "opportunity_proposal" },
  { id: "message-priority", title: "Marquer une conversation à traiter", description: "Met les nouveaux messages entrants dans les priorités.", trigger: "Un nouveau message est reçu", channel: "whatsapp", action: "mark_priority", event: "message_received" },
  { id: "reply-draft", title: "Préparer un brouillon", description: "Prépare uniquement un brouillon local à valider.", trigger: "Un nouveau message est reçu", channel: "linkedin", action: "prepare_draft", event: "message_received" },
  { id: "email-draft", title: "Brouillon de suivi email", description: "Prépare un brouillon à relire après un email entrant.", trigger: "Un nouveau message est reçu", channel: "gmail", action: "prepare_draft", event: "message_received" },
];

import type { ChannelId } from "../state/types";

export type AutomationTemplate = {
  id: string;
  title: string;
  description: string;
  trigger: string;
  channel: ChannelId;
  action: string;
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "linkedin-draft",
    title: "Brouillon LinkedIn à valider",
    description: "Automatisation de préparation de brouillon pour la messagerie LinkedIn.",
    trigger: "Message LinkedIn reçu",
    channel: "linkedin",
    action: "Préparer le brouillon pour validation",
  },
  {
    id: "whatsapp-qualification",
    title: "Qualification WhatsApp",
    description: "Automatisation qui organise la qualification dans la messagerie WhatsApp.",
    trigger: "Message WhatsApp reçu",
    channel: "whatsapp",
    action: "Ouvrir l’étape de qualification",
  },
  {
    id: "gmail-follow-up",
    title: "Suivi Gmail à valider",
    description: "Automatisation de préparation de suivi dans la messagerie Gmail.",
    trigger: "Email Gmail reçu",
    channel: "gmail",
    action: "Préparer le suivi pour validation",
  },
];

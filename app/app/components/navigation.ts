import type { ComponentType } from "react";
import { TbChartLine, TbHierarchy2, TbHome, TbInbox, TbPlugConnected, TbSend, TbSettings, TbUsers } from "react-icons/tb";

export type ProductNavigationItem = {
  href: string;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true" | "false"; size?: number | string; className?: string }>;
  group: "Pilotage" | "Relation" | "Espace";
};

export const productNavigation: ProductNavigationItem[] = [
  { href: "/app", label: "Vue d’ensemble", icon: TbHome, group: "Pilotage" },
  { href: "/app/inbox", label: "Inbox", icon: TbInbox, group: "Pilotage" },
  { href: "/app/campaigns", label: "Campagnes", icon: TbSend, group: "Pilotage" },
  { href: "/app/opportunities", label: "Opportunités", icon: TbChartLine, group: "Relation" },
  { href: "/app/contacts", label: "Contacts", icon: TbUsers, group: "Relation" },
  { href: "/app/automations", label: "Automatisations", icon: TbHierarchy2, group: "Relation" },
  { href: "/app/connections", label: "Connexions", icon: TbPlugConnected, group: "Espace" },
  { href: "/app/settings", label: "Paramètres", icon: TbSettings, group: "Espace" },
];

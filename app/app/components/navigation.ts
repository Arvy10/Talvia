import type { IconType } from "react-icons";
import {
  LuChartNoAxesColumnIncreasing,
  LuSend,
  LuHouse,
  LuInbox,
  LuSettings,
  LuUnplug,
  LuUsers,
  LuWorkflow,
} from "react-icons/lu";

export type ProductNavigationItem = {
  href: string;
  label: string;
  icon: IconType;
  group: "Pilotage" | "Relation" | "Espace";
};

export const productNavigation: ProductNavigationItem[] = [
  { href: "/app", label: "Vue d’ensemble", icon: LuHouse, group: "Pilotage" },
  { href: "/app/inbox", label: "Inbox", icon: LuInbox, group: "Pilotage" },
  { href: "/app/campaigns", label: "Campagnes", icon: LuSend, group: "Pilotage" },
  { href: "/app/opportunities", label: "Opportunités", icon: LuChartNoAxesColumnIncreasing, group: "Relation" },
  { href: "/app/contacts", label: "Contacts", icon: LuUsers, group: "Relation" },
  { href: "/app/automations", label: "Automatisations", icon: LuWorkflow, group: "Relation" },
  { href: "/app/connections", label: "Connexions", icon: LuUnplug, group: "Espace" },
  { href: "/app/settings", label: "Paramètres", icon: LuSettings, group: "Espace" },
];

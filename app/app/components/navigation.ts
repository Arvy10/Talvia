import type { ComponentType } from "react";
import { LuSettings, LuWorkflow } from "react-icons/lu";

import ChartLineIcon from "./icons/ChartLineIcon";
import HomeIcon from "./icons/HomeIcon";
import MailIcon from "./icons/MailIcon";
import PlugConnectedIcon from "./icons/PlugConnectedIcon";
import SendIcon from "./icons/SendIcon";
import UsersGroupIcon from "./icons/UsersGroupIcon";

export type ProductNavigationItem = {
  href: string;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true" | "false"; size?: number | string; className?: string }>;
  group: "Pilotage" | "Relation" | "Espace";
};

export const productNavigation: ProductNavigationItem[] = [
  { href: "/app", label: "Vue d’ensemble", icon: HomeIcon, group: "Pilotage" },
  { href: "/app/inbox", label: "Inbox", icon: MailIcon, group: "Pilotage" },
  { href: "/app/campaigns", label: "Campagnes", icon: SendIcon, group: "Pilotage" },
  { href: "/app/opportunities", label: "Opportunités", icon: ChartLineIcon, group: "Relation" },
  { href: "/app/contacts", label: "Contacts", icon: UsersGroupIcon, group: "Relation" },
  { href: "/app/automations", label: "Automatisations", icon: LuWorkflow, group: "Relation" },
  { href: "/app/connections", label: "Connexions", icon: PlugConnectedIcon, group: "Espace" },
  { href: "/app/settings", label: "Paramètres", icon: LuSettings, group: "Espace" },
];

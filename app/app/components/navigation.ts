import type { IconType } from "react-icons";
import {
  LuChartNoAxesColumnIncreasing,
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
};

export const productNavigation: ProductNavigationItem[] = [
  { href: "/app", label: "Aujourd’hui", icon: LuHouse },
  { href: "/app/inbox", label: "Inbox", icon: LuInbox },
  { href: "/app/opportunities", label: "Opportunités", icon: LuChartNoAxesColumnIncreasing },
  { href: "/app/contacts", label: "Contacts", icon: LuUsers },
  { href: "/app/automations", label: "Automatisations", icon: LuWorkflow },
  { href: "/app/connections", label: "Connexions", icon: LuUnplug },
  { href: "/app/settings", label: "Paramètres", icon: LuSettings },
];

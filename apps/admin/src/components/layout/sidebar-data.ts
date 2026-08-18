import {
  Building2,
  FileKey2,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";

import type { NavGroup, SidebarData } from "./types";

export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: "Management",
      items: [
        { title: "Overview", url: "/", icon: LayoutDashboard, capability: "dashboard.read" },
        { title: "Users", url: "/users", icon: Users, capability: "users.read" },
        { title: "Organizations", url: "/organizations", icon: Building2, capability: "organizations.read" },
        { title: "Sites", url: "/sites", icon: Building2, capability: "sites.read" },
      ],
    },
    {
      title: "Access control",
      items: [
        { title: "Roles", url: "/roles", icon: ShieldCheck, capability: "roles.read" },
        { title: "Sessions", url: "/sessions", icon: FileKey2, capability: "sessions.read" },
        { title: "Audit", url: "/audit", icon: ScrollText, capability: "audit.read" },
      ],
    },
  ],
};

export function navigationForCapabilities(capabilities: ReadonlySet<string>): NavGroup[] {
  return sidebarData.navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !("capability" in item) || !item.capability || capabilities.has(item.capability)),
    }))
    .filter((group) => group.items.length > 0);
}

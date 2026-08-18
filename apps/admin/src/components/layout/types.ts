import type { LucideIcon } from "lucide-react";

export type Capability = string;

export type NavLink = {
  title: string;
  url: string;
  icon?: LucideIcon;
  capability?: Capability;
  items?: never;
};

export type NavCollapsible = {
  title: string;
  icon?: LucideIcon;
  items: NavLink[];
};

export type NavItem = NavLink | NavCollapsible;

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export type SidebarData = {
  navGroups: NavGroup[];
};

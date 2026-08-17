import type { MessageKey } from "../../i18n/messages";

export type IamModuleDescriptor = Readonly<{
  id: "overview" | "users" | "sessions" | "organizations" | "access" | "audit";
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  iconKey: "dashboard" | "users" | "sessions" | "organizations" | "access" | "audit";
  order: number;
}>;

export const iamModuleRegistry: readonly IamModuleDescriptor[] = Object.freeze([
  Object.freeze({ id: "overview", href: "/", labelKey: "nav.overview", groupKey: null, iconKey: "dashboard", order: 10 }),
  Object.freeze({ id: "users", href: "/users", labelKey: "nav.users", groupKey: "nav.group.identity", iconKey: "users", order: 20 }),
  Object.freeze({ id: "sessions", href: "/sessions", labelKey: "nav.sessions", groupKey: "nav.group.identity", iconKey: "sessions", order: 30 }),
  Object.freeze({ id: "organizations", href: "/organizations", labelKey: "nav.organizations", groupKey: "nav.group.organization", iconKey: "organizations", order: 40 }),
  Object.freeze({ id: "access", href: "/access", labelKey: "nav.access", groupKey: "nav.group.access", iconKey: "access", order: 50 }),
  Object.freeze({ id: "audit", href: "/audit", labelKey: "nav.audit", groupKey: "nav.group.access", iconKey: "audit", order: 60 }),
]);

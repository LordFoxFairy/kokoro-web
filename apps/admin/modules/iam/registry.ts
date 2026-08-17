import type { MessageKey } from "../../i18n/messages";
import { platformAdminCapability, type AdminCapability, type AdminCapabilityScope } from "../../lib/admin-capabilities";

export type IamModuleDescriptor = Readonly<{
  id: "overview" | "users" | "sessions" | "sites" | "organizations" | "access" | "audit";
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  iconKey: "dashboard" | "users" | "sessions" | "sites" | "organizations" | "access" | "audit";
  order: number;
  scope: AdminCapabilityScope;
  requiredPermission: AdminCapability;
}>;

export const iamModuleRegistry: readonly IamModuleDescriptor[] = Object.freeze([
  Object.freeze({ id: "overview", href: "/", labelKey: "nav.overview", groupKey: null, iconKey: "dashboard", order: 10, scope: "platform", requiredPermission: platformAdminCapability }),
  Object.freeze({ id: "users", href: "/users", labelKey: "nav.users", groupKey: "nav.group.identity", iconKey: "users", order: 20, scope: "platform", requiredPermission: platformAdminCapability }),
  Object.freeze({ id: "sessions", href: "/sessions", labelKey: "nav.sessions", groupKey: "nav.group.identity", iconKey: "sessions", order: 30, scope: "platform", requiredPermission: platformAdminCapability }),
  Object.freeze({ id: "sites", href: "/sites", labelKey: "nav.sites", groupKey: "nav.group.tenant", iconKey: "sites", order: 40, scope: "platform", requiredPermission: platformAdminCapability }),
  Object.freeze({ id: "organizations", href: "/organizations", labelKey: "nav.organizations", groupKey: "nav.group.organization", iconKey: "organizations", order: 50, scope: "platform", requiredPermission: platformAdminCapability }),
  Object.freeze({ id: "access", href: "/access", labelKey: "nav.access", groupKey: "nav.group.access", iconKey: "access", order: 60, scope: "platform", requiredPermission: platformAdminCapability }),
  Object.freeze({ id: "audit", href: "/audit", labelKey: "nav.audit", groupKey: "nav.group.access", iconKey: "audit", order: 70, scope: "platform", requiredPermission: platformAdminCapability }),
]);

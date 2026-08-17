import type { MessageKey } from "../i18n/messages";
import { hasAdminCapability, type AdminCapability, type AdminCapabilityScope } from "../lib/admin-capabilities";
import { iamModuleRegistry } from "./iam/registry";

export type AdminIconKey = "dashboard" | "users" | "sessions" | "sites" | "organizations" | "access" | "audit";

export type AdminModuleDescriptor = Readonly<{
  key: string;
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  iconKey: AdminIconKey;
  order: number;
  executable: true;
  scope: AdminCapabilityScope;
  requiredPermission: AdminCapability;
}>;

export const adminModuleRegistry: readonly AdminModuleDescriptor[] = Object.freeze(
  iamModuleRegistry
    .map((module) => Object.freeze({
      key: `iam.${module.id}`,
      href: module.href,
      labelKey: module.labelKey,
      groupKey: module.groupKey,
      iconKey: module.iconKey,
      order: module.order,
      executable: true as const,
      scope: module.scope,
      requiredPermission: module.requiredPermission,
    }))
    .sort((left, right) => left.order - right.order),
);

export function projectAdminModules(
  capabilities: readonly AdminCapability[],
): readonly AdminModuleDescriptor[] {
  return Object.freeze(adminModuleRegistry.filter((module) => (
    hasAdminCapability(capabilities, module.requiredPermission)
  )));
}

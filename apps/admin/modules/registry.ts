import type { MessageKey } from "../i18n/messages";
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
    }))
    .sort((left, right) => left.order - right.order),
);

import {
  ApartmentOutlined,
  AuditOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";

import type { MessageKey } from "@/i18n/messages";
import type { AdminCapability } from "@/lib/admin-capabilities";
import { adminModuleRegistry, projectAdminModules, type AdminIconKey } from "@/modules/registry";

export type AdminNavigationItem = Readonly<{
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  icon: React.ComponentType;
}>;

const icons: Readonly<Record<AdminIconKey, React.ComponentType>> = Object.freeze({
  dashboard: DashboardOutlined,
  users: TeamOutlined,
  sessions: UserSwitchOutlined,
  sites: AppstoreOutlined,
  organizations: ApartmentOutlined,
  access: SafetyCertificateOutlined,
  audit: AuditOutlined,
});

export const adminNavigation: readonly AdminNavigationItem[] = Object.freeze(
  adminModuleRegistry.map((module) => Object.freeze({
    href: module.href,
    labelKey: module.labelKey,
    groupKey: module.groupKey,
    icon: icons[module.iconKey],
  })),
);

export function projectAdminNavigation(
  capabilities: readonly AdminCapability[],
): readonly AdminNavigationItem[] {
  const allowed = new Set(projectAdminModules(capabilities).map((module) => module.href));
  return Object.freeze(adminNavigation.filter((item) => allowed.has(item.href)));
}

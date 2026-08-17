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
import { adminModuleRegistry, type AdminIconKey } from "@/modules/registry";

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

import {
  ApartmentOutlined,
  AuditOutlined,
  DashboardOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";

import type { MessageKey } from "@/i18n/messages";
import { iamModuleRegistry, type IamModuleDescriptor } from "@/modules/iam/registry";

export type AdminNavigationItem = Readonly<{
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  icon: React.ComponentType;
}>;

const icons: Readonly<Record<IamModuleDescriptor["iconKey"], React.ComponentType>> = Object.freeze({
  dashboard: DashboardOutlined,
  users: TeamOutlined,
  sessions: UserSwitchOutlined,
  organizations: ApartmentOutlined,
  access: SafetyCertificateOutlined,
  audit: AuditOutlined,
});

export const adminNavigation: readonly AdminNavigationItem[] = Object.freeze(
  iamModuleRegistry.map((module) => Object.freeze({
    href: module.href,
    labelKey: module.labelKey,
    groupKey: module.groupKey,
    icon: icons[module.iconKey],
  })),
);

import {
  ApartmentOutlined,
  DashboardOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";

import type { MessageKey } from "@/i18n/messages";

export type AdminNavigationItem = Readonly<{
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  icon: React.ComponentType;
}>;

export const adminNavigation: readonly AdminNavigationItem[] = Object.freeze([
  Object.freeze({ href: "/", labelKey: "nav.overview", groupKey: null, icon: DashboardOutlined }),
  Object.freeze({ href: "/users", labelKey: "nav.users", groupKey: "nav.group.identity", icon: TeamOutlined }),
  Object.freeze({ href: "/sessions", labelKey: "nav.sessions", groupKey: "nav.group.identity", icon: UserSwitchOutlined }),
  Object.freeze({ href: "/organizations", labelKey: "nav.organizations", groupKey: "nav.group.access", icon: ApartmentOutlined }),
  Object.freeze({ href: "/access", labelKey: "nav.access", groupKey: "nav.group.access", icon: SafetyCertificateOutlined }),
]);

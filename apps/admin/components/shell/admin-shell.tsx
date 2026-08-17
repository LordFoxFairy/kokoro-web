"use client";

import { GlobalOutlined, LogoutOutlined, SafetyCertificateFilled, UserOutlined } from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-layout";
import { Avatar, Button, Select, Space, Tooltip } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createElement } from "react";

import { useLocale, useT } from "@/i18n/context";
import { ADMIN_LAYOUT, proLayoutToken } from "@/lib/theme";

import { adminNavigation } from "./navigation";

export type SafeAdministrator = Readonly<{
  id: string;
  email: string;
  name?: string | null;
}>;

export type AdminShellProps = Readonly<{
  administrator: SafeAdministrator;
  children: React.ReactNode;
  pathname?: string;
  signOutAction: () => Promise<void>;
}>;

export function AdminShell({
  administrator,
  children,
  pathname,
  signOutAction,
}: AdminShellProps): React.ReactElement {
  const detectedPathname = usePathname();
  const currentPathname = pathname ?? detectedPathname;
  const t = useT();
  const { locale, setLocale } = useLocale();
  const menuItem = (item: (typeof adminNavigation)[number]) => ({
    path: item.href,
    name: t(item.labelKey),
    icon: createElement(item.icon),
  });
  const groupKeys = [
    "nav.group.identity",
    "nav.group.tenant",
    "nav.group.organization",
    "nav.group.access",
  ] as const;
  const ungrouped = adminNavigation.filter((item) => item.groupKey === null).map(menuItem);
  const routes = [
    ...ungrouped,
    ...groupKeys.flatMap((groupKey) => {
      const items = adminNavigation.filter((item) => item.groupKey === groupKey).map(menuItem);
      return items.length === 0
        ? []
        : [{ path: `/__group/${groupKey}`, name: t(groupKey), routes: items }];
    }),
  ];
  const layoutStyle = {
    "--admin-header-height": `${ADMIN_LAYOUT.headerHeight}px`,
    "--admin-menu-icon-size": `${ADMIN_LAYOUT.menuIconSize}px`,
    "--admin-command-icon-size": `${ADMIN_LAYOUT.commandIconSize}px`,
    "--admin-content-max-width": `${ADMIN_LAYOUT.contentMaxWidth}px`,
  } as React.CSSProperties;

  return (
    <ProLayout
      className="admin-shell"
      style={layoutStyle}
      title={`${t("app.name")} · ${t("app.product")}`}
      logo={<span className="admin-logo-mark"><SafetyCertificateFilled /></span>}
      layout="mix"
      fixSiderbar
      fixedHeader
      breakpoint="lg"
      siderWidth={ADMIN_LAYOUT.siderWidth}
      location={{ pathname: currentPathname }}
      route={{ path: "/", routes }}
      menu={{ loading: false, defaultOpenAll: true, type: "group" }}
      token={proLayoutToken}
      menuItemRender={(item, dom) => <Link href={item.path ?? "/"}>{dom}</Link>}
      menuContentRender={(_props, defaultDom) => (
        <nav aria-label={t("nav.primary")}>{defaultDom}</nav>
      )}
      actionsRender={() => [
        <Select
          key="locale"
          className="admin-language"
          aria-label={t("shell.language")}
          value={locale}
          onChange={setLocale}
          variant="borderless"
          suffixIcon={<GlobalOutlined />}
          options={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />,
        <Space key="identity" className="admin-account" size={8}>
          <Avatar size={28} icon={<UserOutlined />} />
          <span className="admin-identity" title={administrator.email}>
            {administrator.email}
          </span>
        </Space>,
        <form key="logout" action={signOutAction}>
          <Tooltip title={t("shell.signOut")}>
            <Button
              aria-label={t("shell.signOut")}
              htmlType="submit"
              icon={<LogoutOutlined />}
              type="text"
            />
          </Tooltip>
        </form>,
      ]}
    >
      <div className="admin-workspace">{children}</div>
    </ProLayout>
  );
}

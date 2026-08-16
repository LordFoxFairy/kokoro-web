"use client";

import { DashboardOutlined, LogoutOutlined } from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-components";
import { Button, Select } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLocale, useT } from "@/i18n/context";
import { proLayoutToken } from "@/lib/theme";

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
  const routes = adminNavigation.map((item) => ({
    path: item.href,
    name: t(item.labelKey),
    icon: <DashboardOutlined />,
  }));

  return (
    <ProLayout
      className="admin-shell"
      title={t("app.name")}
      logo={false}
      layout="mix"
      fixSiderbar
      fixedHeader
      breakpoint="lg"
      siderWidth={208}
      location={{ pathname: currentPathname }}
      route={{ path: "/", routes }}
      menu={{ loading: false }}
      token={proLayoutToken}
      menuItemRender={(item, dom) => <Link href={item.path ?? "/"}>{dom}</Link>}
      menuContentRender={(_props, defaultDom) => (
        <nav aria-label={t("nav.primary")}>{defaultDom}</nav>
      )}
      actionsRender={() => [
        <Select
          key="locale"
          aria-label={t("shell.language")}
          value={locale}
          onChange={setLocale}
          variant="borderless"
          options={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />,
        <span key="identity" className="admin-identity" title={administrator.name ?? administrator.email}>
          {administrator.email}
        </span>,
        <form key="logout" action={signOutAction}>
          <Button
            aria-label={t("shell.signOut")}
            htmlType="submit"
            icon={<LogoutOutlined />}
            type="text"
          />
        </form>,
      ]}
    >
      <div className="admin-workspace">{children}</div>
    </ProLayout>
  );
}

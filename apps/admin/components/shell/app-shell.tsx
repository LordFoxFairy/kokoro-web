"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { App, ConfigProvider, Dropdown, Select } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ProLayout } from "@ant-design/pro-components";
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import {
  ApiOutlined,
  CheckCircleOutlined,
  DashboardOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LogoutOutlined,
  SafetyOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { apiGet } from "@/lib/api";
import { collectCursorPages } from "@/lib/cursor-pagination";
import { LatestRequest } from "@/lib/cursor-window";
import {
  permits,
  type Me,
  type Site,
} from "@/lib/schemas";
import { antdTheme, proLayoutToken } from "@/lib/theme";
import { LocaleProvider, useLocale, useT } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import { adminNavigationAccess } from "@/lib/admin-surface-permissions";
import { adminDataProvider, adminSiteListSchema, operatorSchema } from "@/lib/refine/admin-data-provider";

interface AdminCtx {
  me: Me | null;
  sites: Site[];
  siteId: string;
  setSiteId: (id: string) => void;
  can: (permission: string | null) => boolean;
  reloadSites: () => void;
}

const AdminContext = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AppShell");
  return ctx;
}

interface NavItem {
  labelKey: MessageKey;
  href: string;
  icon: React.ReactNode;
  perm: string | null;
  signedSurface?: "users" | "credit";
}

// 导航文案走 i18n（labelKey）；此处只声明结构，渲染时经 useT 解析。
const NAV: { groupKey: MessageKey | null; items: NavItem[] }[] = [
  { groupKey: null, items: [{ labelKey: "nav.overview", href: "/", icon: <DashboardOutlined />, perm: null }] },
  {
    groupKey: "nav.group.business",
    items: [
      { labelKey: "nav.users", href: "/users", icon: <UserOutlined />, perm: null, signedSurface: "users" },
      { labelKey: "nav.credit", href: "/credit", icon: <WalletOutlined />, perm: null, signedSurface: "credit" },
      { labelKey: "nav.sites", href: "/sites", icon: <GlobalOutlined />, perm: "site.read" },
      { labelKey: "nav.models", href: "/models", icon: <ApiOutlined />, perm: "model.read" },
    ],
  },
  {
    groupKey: "nav.group.ops",
    items: [
      { labelKey: "nav.approvals", href: "/approvals", icon: <CheckCircleOutlined />, perm: null },
      { labelKey: "nav.audit", href: "/audit", icon: <FileTextOutlined />, perm: null },
      { labelKey: "nav.operators", href: "/operators", icon: <SafetyOutlined />, perm: "operator.read" },
    ],
  },
];

interface MenuRoute {
  path: string;
  name: string;
  icon?: React.ReactNode;
  routes?: MenuRoute[];
}

function AppShellInner({ children }: { children: React.ReactNode }): React.ReactElement {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [siteCatalogError, setSiteCatalogError] = useState<string | null>(null);
  const siteCatalogRequests = useRef(new LatestRequest());
  const pathname = usePathname();
  const isPublicRoute = pathname.startsWith("/login") || pathname.startsWith("/auth/verify");

  const reloadSites = useCallback(() => {
    const generation = siteCatalogRequests.current.begin();
    apiGet("/api/control/operator", operatorSchema)
      .then((loaded) => {
        if (!siteCatalogRequests.current.isCurrent(generation)) return;
        setMe({ email: loaded.operatorRef, roleKey: loaded.state, permissions: loaded.effectivePermissions,
          scopeSites: loaded.effectiveSiteScopes.map((site) => site.siteId) });
      })
      .catch(() => {});
    collectCursorPages(
      (pageToken, signal) => apiGet(
        `/api/control/sites${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        adminSiteListSchema,
        { signal },
      ),
      { identity: (site) => site.siteRef, maxItems: 1000, maxPages: 20, timeoutMs: 5_000 },
    )
      .then((loaded) => {
        if (!siteCatalogRequests.current.isCurrent(generation)) return;
        const available = loaded.map((site) => ({ id: site.siteRef, name: site.siteRef, key: site.siteRef }));
        setSiteCatalogError(null);
        setSites(available);
        setSiteId((previous) => available.some((site) => site.id === previous) ? previous : available[0]?.id ?? "");
      })
      .catch((error: unknown) => {
        if (!siteCatalogRequests.current.isCurrent(generation)) return;
        setSiteCatalogError(error instanceof Error ? error.message : "admin_site_catalog_incomplete");
      });
  }, []);

  useEffect(() => {
    const requestGate = siteCatalogRequests.current;
    if (isPublicRoute) {
      requestGate.invalidate();
      return;
    }
    reloadSites();
    return () => { requestGate.invalidate(); };
  }, [isPublicRoute, reloadSites]);

  const can = (permission: string | null): boolean =>
    permission === null || permits(me?.permissions ?? [], permission);
  const signedNavigation = adminNavigationAccess(me?.permissions ?? []);

  const ctx: AdminCtx = { me, sites, siteId, setSiteId, can, reloadSites };
  const framework = (
    <Refine
      dataProvider={adminDataProvider}
      routerProvider={routerProvider}
      resources={[
        { name: "operators", list: "/operators", meta: { label: "操作员" } },
        { name: "sites", list: "/sites", meta: { label: "站点" } },
        { name: "approvals", list: "/approvals", meta: { label: "审批" } },
        { name: "audit", list: "/audit", meta: { label: "审计" } },
      ]}
      options={{ disableTelemetry: true, syncWithLocation: true, warnWhenUnsavedChanges: true }}
    >
      {children}
    </Refine>
  );

  // 登录/确认页只给主题、不套 ProLayout。
  if (isPublicRoute) {
    return (
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        <App>
          <AdminContext.Provider value={ctx}>{framework}</AdminContext.Provider>
        </App>
      </ConfigProvider>
    );
  }

  const routes: MenuRoute[] = NAV.flatMap((section): MenuRoute[] => {
    const items = section.items.filter((i) => i.signedSurface ? signedNavigation[i.signedSurface] : can(i.perm));
    if (items.length === 0) return [];
    const mapped: MenuRoute[] = items.map((i) => ({ path: i.href, name: t(i.labelKey), icon: i.icon }));
    return section.groupKey
      ? [{ path: `/__${section.groupKey}`, name: t(section.groupKey), routes: mapped }]
      : mapped;
  });

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <App>
        <AdminContext.Provider value={ctx}>
          <ProLayout
            title="Kokoro"
            logo={false}
            layout="mix"
            fixSiderbar
            fixedHeader
            siderWidth={216}
            location={{ pathname }}
            route={{ path: "/", routes }}
            token={proLayoutToken}
            menu={{ type: "group" }}
            menuItemRender={(item, dom) => <Link href={item.path ?? "/"}>{dom}</Link>}
            avatarProps={{
              icon: <UserOutlined />,
              size: "small",
              title: me?.email ?? "…",
              render: (_props, dom) => (
                <Dropdown
                  menu={{
                    items: [
                      { key: "role", label: me?.roleKey ?? "", disabled: true },
                      { type: "divider" },
                      {
                        key: "logout",
                        icon: <LogoutOutlined />,
                        label: t("ui.logout"),
                        onClick: () => fetch("/api/control/auth/logout", { method: "POST" })
                          .then(() => { window.location.href = "/login"; }),
                      },
                    ],
                  }}
                >
                  {dom}
                </Dropdown>
              ),
            }}
            actionsRender={() => [
              <Select
                key="site"
                value={siteId || undefined}
                onChange={setSiteId}
                placeholder={t("ui.selectSite")}
                style={{ width: 200 }}
                variant="filled"
                status={siteCatalogError ? "error" : undefined}
                options={sites.map((s) => ({ value: s.id, label: s.name ?? s.key ?? s.id }))}
                notFoundContent={siteCatalogError ?? t("ui.noSite")}
              />,
              ...(siteCatalogError ? [<span key="site-error" role="alert" style={{ color: "#ff4d4f" }}>
                站点目录未完整加载
              </span>] : []),
              <Select
                key="locale"
                aria-label={t("ui.language")}
                value={locale}
                onChange={setLocale}
                style={{ width: 92 }}
                variant="filled"
                options={[
                  { value: "zh", label: "中文" },
                  { value: "en", label: "English" },
                ]}
              />,
            ]}
          >
            {framework}
          </ProLayout>
        </AdminContext.Provider>
      </App>
    </ConfigProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <LocaleProvider>
      <AppShellInner>{children}</AppShellInner>
    </LocaleProvider>
  );
}

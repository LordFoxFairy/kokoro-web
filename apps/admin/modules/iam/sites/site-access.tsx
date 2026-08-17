"use client";

import { CheckCircleOutlined, CloseCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { ProFormSelect, ProFormText } from "@ant-design/pro-form";
import { Alert, Descriptions, Tag } from "antd";
import { useRouter } from "next/navigation";

import { AdminQueryFilter } from "@/components/forms/admin-query-filter";
import { AdminSection } from "@/components/platform/admin-section";
import { useT } from "@/i18n/context";

import type { SiteAuthorizationView, SiteDetailFilters, SiteMemberListView } from "./schema";
import { siteDetailHref } from "./url";

export function SiteAccess({ siteId, permissionKeys, members, filters, authorization }: Readonly<{ siteId: string; permissionKeys: readonly string[]; members: SiteMemberListView; filters: SiteDetailFilters; authorization: SiteAuthorizationView | null }>): React.ReactElement {
  const t = useT(); const router = useRouter();
  return <div className="site-access-grid">
    <AdminSection titleId="site-access-check-title" title={t("siteAccess.check")} icon={<SafetyCertificateOutlined />}>
      <AdminQueryFilter ariaLabel={t("siteAccess.evaluate")} initialValues={{ permissionKey: filters.permissionKey ?? undefined, authorizationUserId: filters.authorizationUserId ?? undefined, resourceRef: filters.resourceRef ?? undefined }} searchText={t("siteAccess.evaluate")} resetText={t("common.reset")} onSubmit={(values: { permissionKey?: string; authorizationUserId?: string; resourceRef?: string }) => router.push(siteDetailHref(siteId, { ...filters, tab: "access", permissionKey: values.permissionKey ?? null, authorizationUserId: values.authorizationUserId ?? null, resourceRef: values.resourceRef?.trim() || null }))} onReset={() => router.push(siteDetailHref(siteId, { ...filters, tab: "access", permissionKey: null, authorizationUserId: null, resourceRef: null }))}>
        <ProFormSelect name="permissionKey" label={t("siteAccess.permission")} fieldProps={{ "aria-label": t("siteAccess.permission") }} options={permissionKeys.map((key) => ({ value: key, label: key }))} />
        <ProFormSelect name="authorizationUserId" label={t("siteAccess.user")} fieldProps={{ allowClear: true, "aria-label": t("siteAccess.user") }} options={members.items.map((member) => ({ value: member.userId, label: member.userLabel }))} />
        <ProFormText name="resourceRef" label={t("siteAccess.resourceRef")} fieldProps={{ "aria-label": t("siteAccess.resourceRef") }} />
      </AdminQueryFilter>
      {authorization === null ? <Alert type="info" showIcon title={t("siteAccess.noDecision")} /> : <Alert type={authorization.allowed ? "success" : "error"} showIcon icon={authorization.allowed ? <CheckCircleOutlined /> : <CloseCircleOutlined />} title={t(authorization.allowed ? "siteAccess.allowed" : "siteAccess.denied")} description={<Descriptions size="small" column={2} items={[{ key: "reason", label: t("siteAccess.reason"), children: <code>{authorization.reasonCode}</code> }, { key: "version", label: t("siteAccess.version"), children: <code>{authorization.authorizationVersion}</code> }, { key: "roles", label: t("siteAccess.roles"), children: authorization.roleKeys.join(", ") || t("common.none") }, { key: "time", label: t("siteAccess.evaluatedAt"), children: <time dateTime={authorization.evaluatedAt}>{authorization.evaluatedAt}</time> }]} />} />}
    </AdminSection>
    <AdminSection titleId="site-permission-catalog-title" title={t("siteAccess.catalog")}><div className="permission-key-list">{permissionKeys.length === 0 ? t("state.empty.title") : permissionKeys.map((key) => <Tag key={key}>{key}</Tag>)}</div></AdminSection>
  </div>;
}

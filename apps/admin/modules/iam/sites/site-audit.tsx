"use client";

import { EyeOutlined } from "@ant-design/icons";
import { ProFormText } from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button, Descriptions, Drawer, Statistic } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminTable } from "@/components/data/admin-table";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { PageState } from "@/components/feedback/page-state";
import { AdminQueryFilter } from "@/components/forms/admin-query-filter";
import { AdminSection } from "@/components/platform/admin-section";
import { useT } from "@/i18n/context";

import type { SiteDetailFilters, SiteDetailView, SiteAuditEventView } from "./schema";
import { siteDetailHref } from "./url";

export function SiteAudit({ siteId, audit, filters }: Readonly<{ siteId: string; audit: SiteDetailView["audit"]; filters: SiteDetailFilters }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [selected, setSelected] = useState<SiteAuditEventView | null>(null);
  const columns: ProColumns<SiteAuditEventView>[] = [
    { title: t("audit.kind"), dataIndex: "kind", width: 220 },
    { title: t("audit.actorUserId"), dataIndex: "actorUserId", width: 300, className: "technical-value", render: (_, event) => event.actorUserId ?? t("common.none") },
    { title: t("audit.targetUserId"), dataIndex: "targetUserId", width: 300, className: "technical-value", render: (_, event) => event.targetUserId ?? t("common.none") },
    { title: t("audit.requestId"), dataIndex: "requestId", width: 300, className: "technical-value" },
    { title: t("audit.createdAt"), dataIndex: "createdAt", width: 190, render: (_, event) => <time dateTime={event.createdAt}>{event.createdAt}</time> },
    { title: t("siteAudit.details"), key: "details", width: 90, render: (_, event) => <Button type="text" size="small" icon={<EyeOutlined />} aria-label={t("siteAudit.viewDetails")} onClick={() => setSelected(event)}>{t("siteAudit.view")}</Button> },
  ];
  return <AdminSection titleId="site-audit-title" title={t("siteAudit.title")} description={t("siteAudit.description")} extra={<Statistic className="site-audit-total" title={t("audit.total")} value={audit.statistics.total} />}>
    <AdminQueryFilter ariaLabel={t("siteAudit.applyFilters")} initialValues={{ auditKind: filters.auditKind ?? undefined, auditActorUserId: filters.auditActorUserId ?? undefined, auditTargetUserId: filters.auditTargetUserId ?? undefined }} searchText={t("siteAudit.applyFilters")} resetText={t("common.reset")} onSubmit={(values: { auditKind?: string; auditActorUserId?: string; auditTargetUserId?: string }) => router.push(siteDetailHref(siteId, { ...filters, tab: "audit", auditKind: values.auditKind?.trim() || null, auditActorUserId: values.auditActorUserId?.trim() || null, auditTargetUserId: values.auditTargetUserId?.trim() || null, auditCursor: null }))} onReset={() => router.push(siteDetailHref(siteId, { ...filters, tab: "audit", auditKind: null, auditActorUserId: null, auditTargetUserId: null, auditCursor: null }))}>
      <ProFormText name="auditKind" label={t("audit.kind")} fieldProps={{ "aria-label": t("audit.kind") }} />
      <ProFormText name="auditActorUserId" label={t("audit.actorUserId")} fieldProps={{ "aria-label": t("audit.actorUserId") }} />
      <ProFormText name="auditTargetUserId" label={t("audit.targetUserId")} fieldProps={{ "aria-label": t("audit.targetUserId") }} />
    </AdminQueryFilter>
    <div className="site-audit-kind-summary">{audit.statistics.byKind.map((item) => <span key={item.kind}><code>{item.kind}</code><strong>{item.count}</strong></span>)}</div>
    <AdminTable ariaLabel={t("siteAudit.title")} columns={columns} data={audit.items} emptyText={<PageState kind="empty" />} rowKey="id" scrollX={1410} />
    <CursorPagination canGoBack={filters.auditCursor !== null} nextCursor={audit.nextCursor} onPrevious={() => router.back()} onNext={(cursor) => router.push(siteDetailHref(siteId, { ...filters, tab: "audit", auditCursor: cursor }))} />
    <Drawer open={selected !== null} title={t("siteAudit.eventDetails")} size="large" onClose={() => setSelected(null)}>{selected === null ? null : <Descriptions bordered size="small" column={1} items={[{ key: "kind", label: t("audit.kind"), children: selected.kind }, { key: "site", label: "Site ID", children: <code>{selected.siteId}</code> }, { key: "actor", label: t("audit.actorUserId"), children: <code>{selected.actorUserId ?? t("common.none")}</code> }, { key: "target", label: t("audit.targetUserId"), children: <code>{selected.targetUserId ?? t("common.none")}</code> }, { key: "request", label: t("audit.requestId"), children: <code>{selected.requestId}</code> }, { key: "command", label: t("audit.commandId"), children: <code>{selected.commandId ?? t("common.none")}</code> }, { key: "time", label: t("audit.createdAt"), children: <time dateTime={selected.createdAt}>{selected.createdAt}</time> }]} />}</Drawer>
  </AdminSection>;
}

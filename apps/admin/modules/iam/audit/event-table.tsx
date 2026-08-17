"use client";

import { EyeOutlined } from "@ant-design/icons";
import { ProFormText } from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button, Descriptions, Drawer, Statistic, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminTable } from "@/components/data/admin-table";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { PageState } from "@/components/feedback/page-state";
import { AdminQueryFilter } from "@/components/forms/admin-query-filter";
import { AdminPage } from "@/components/platform/admin-page";
import { useT } from "@/i18n/context";

import type { AuditEventView, AuditFilters, AuditMetadata, AuditView } from "./schema";
import { auditHref } from "./url";

export function AuditEventTable({ view }: Readonly<{ view: AuditView }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<AuditEventView | null>(null);
  const columns: ProColumns<AuditEventView>[] = [
    { title: t("audit.kind"), dataIndex: "kind", width: 190, className: "technical-value" },
    { title: t("audit.actorUserId"), dataIndex: "actorUserId", width: 300, render: (_, event) => copyableId(event.actorUserId) },
    { title: t("audit.targetUserId"), dataIndex: "targetUserId", width: 300, render: (_, event) => copyableId(event.targetUserId) },
    { title: t("audit.organizationId"), dataIndex: "organizationId", width: 300, render: (_, event) => copyableId(event.organizationId) },
    { title: t("audit.siteId"), dataIndex: "siteId", width: 300, render: (_, event) => copyableId(event.siteId) },
    { title: t("audit.sessionId"), dataIndex: "sessionId", width: 300, render: (_, event) => copyableId(event.sessionId) },
    { title: t("audit.requestId"), dataIndex: "requestId", width: 300, render: (_, event) => copyableId(event.requestId) },
    { title: t("audit.commandId"), dataIndex: "commandId", width: 300, render: (_, event) => copyableId(event.commandId) },
    { title: t("audit.metadata"), dataIndex: "metadata", width: 260, render: (_, event) => metadataText(event.metadata) },
    {
      title: t("audit.createdAt"),
      dataIndex: "createdAt",
      width: 230,
      className: "technical-value",
      render: (_, event) => <time dateTime={event.createdAt}>{event.createdAt}</time>,
    },
    {
      title: t("audit.actions"), key: "actions", fixed: "right", width: 110,
      render: (_, event) => <Button aria-label={t("audit.viewDetail")} type="link" size="small" icon={<EyeOutlined />} onClick={() => setSelected(event)}>{t("audit.viewDetail")}</Button>,
    },
  ];
  const filtered = Object.entries(view.filters).some(([key, value]) => (
    key !== "cursor" && key !== "limit" && value !== null
  ));
  const initialFilters = {
    kind: view.filters.kind ?? "",
    actorUserId: view.filters.actorUserId ?? "",
    targetUserId: view.filters.targetUserId ?? "",
    organizationId: view.filters.organizationId ?? "",
    siteId: view.filters.siteId ?? "",
    commandId: view.filters.commandId ?? "",
    createdAfter: view.filters.createdAfter ?? "",
    createdBefore: view.filters.createdBefore ?? "",
  };

  function navigateWithFilters(values: typeof initialFilters): void {
    const filters: AuditFilters = {
      ...view.filters,
      kind: blankToNull(values.kind),
      actorUserId: blankToNull(values.actorUserId),
      targetUserId: blankToNull(values.targetUserId),
      organizationId: blankToNull(values.organizationId),
      siteId: blankToNull(values.siteId),
      commandId: blankToNull(values.commandId),
      createdAfter: blankToNull(values.createdAfter),
      createdBefore: blankToNull(values.createdBefore),
      cursor: null,
    };
    router.push(auditHref(filters));
  }

  return (
    <AdminPage titleId="audit-title" title={t("audit.title")} description={t("audit.description")}>
      <AdminQueryFilter
        ariaLabel={t("audit.applyFilters")}
        initialValues={initialFilters}
        searchText={t("audit.applyFilters")}
        resetText={t("common.reset")}
        onSubmit={navigateWithFilters}
        onReset={() => navigateWithFilters({
          kind: "",
          actorUserId: "",
          targetUserId: "",
          organizationId: "",
          siteId: "",
          commandId: "",
          createdAfter: "",
          createdBefore: "",
        })}
      >
        <FilterInput name="kind" label={t("audit.kind")} />
        <FilterInput name="actorUserId" label={t("audit.actorUserId")} />
        <FilterInput name="targetUserId" label={t("audit.targetUserId")} />
        <FilterInput name="organizationId" label={t("audit.organizationId")} />
        <FilterInput name="siteId" label={t("audit.siteId")} />
        <FilterInput name="commandId" label={t("audit.commandId")} />
        <FilterInput name="createdAfter" label={t("audit.createdAfter")} />
        <FilterInput name="createdBefore" label={t("audit.createdBefore")} />
      </AdminQueryFilter>
      <section className="audit-statistics" aria-label={t("audit.statistics")}>
        <Statistic title={t("audit.total")} value={view.statistics.total} />
        {view.statistics.byKind.map((item) => (
          <Statistic key={item.kind} title={item.kind} value={item.count} />
        ))}
      </section>
      <AdminTable<AuditEventView>
        ariaLabel={t("audit.title")}
        columns={columns}
        data={view.items}
        emptyText={<PageState kind={filtered ? "filtered-empty" : "empty"} />}
        rowKey="id"
        scrollX={2_780}
      />
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(auditHref(view.filters, cursor))}
      />
      <Drawer open={selected !== null} title={t("audit.detailTitle")} size="large" onClose={() => setSelected(null)}>
        {selected === null ? null : <AuditEventDetail event={selected} />}
      </Drawer>
    </AdminPage>
  );
}

function AuditEventDetail({ event }: Readonly<{ event: AuditEventView }>): React.ReactElement {
  const t = useT();
  const rows = [
    [t("audit.kind"), event.kind], [t("audit.actorUserId"), event.actorUserId],
    [t("audit.targetUserId"), event.targetUserId], [t("audit.organizationId"), event.organizationId],
    [t("audit.siteId"), event.siteId], [t("audit.sessionId"), event.sessionId],
    [t("audit.requestId"), event.requestId], [t("audit.commandId"), event.commandId],
    [t("audit.createdAt"), event.createdAt],
  ] as const;
  return <Descriptions bordered size="small" column={1}>
    {rows.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value === null ? t("common.none") : <code>{value}</code>}</Descriptions.Item>)}
    <Descriptions.Item label={t("audit.metadata")}>
      {event.metadata === null ? t("common.none") : <dl className="audit-metadata-list">{Object.entries(event.metadata).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}
    </Descriptions.Item>
  </Descriptions>;
}

function FilterInput({
  name,
  label,
}: Readonly<{ name: string; label: string }>): React.ReactElement {
  return (
    <ProFormText name={name} label={label} fieldProps={{ "aria-label": label }} />
  );
}

function blankToNull(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}

function copyableId(value: string | null): React.ReactNode {
  if (value === null) return null;
  return (
    <Typography.Text className="technical-value" copyable={{ text: value }}>
      <code>{value}</code>
    </Typography.Text>
  );
}

function metadataText(value: AuditMetadata | null): React.ReactNode {
  if (value === null) return null;
  return <code>{Object.entries(value).map(([key, item]) => `${key}=${String(item)}`).join(", ")}</code>;
}

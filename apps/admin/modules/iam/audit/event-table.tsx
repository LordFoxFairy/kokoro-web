"use client";

import { Button, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";

import { CursorPagination } from "@/components/data/cursor-pagination";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";

import type { AuditEventView, AuditMetadata, AuditView } from "./schema";
import { auditHref } from "./url";

export function AuditEventTable({ view }: Readonly<{ view: AuditView }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const columns: ColumnsType<AuditEventView> = [
    { title: t("audit.kind"), dataIndex: "kind", width: 190, className: "technical-value" },
    { title: t("audit.actorUserId"), dataIndex: "actorUserId", width: 300, render: copyableId },
    { title: t("audit.targetUserId"), dataIndex: "targetUserId", width: 300, render: copyableId },
    { title: t("audit.organizationId"), dataIndex: "organizationId", width: 300, render: copyableId },
    { title: t("audit.sessionId"), dataIndex: "sessionId", width: 300, render: copyableId },
    { title: t("audit.requestId"), dataIndex: "requestId", width: 300, render: copyableId },
    { title: t("audit.commandId"), dataIndex: "commandId", width: 300, render: copyableId },
    { title: t("audit.metadata"), dataIndex: "metadata", width: 260, render: metadataText },
    {
      title: t("audit.createdAt"),
      dataIndex: "createdAt",
      width: 230,
      className: "technical-value",
      render: (value: string) => <time dateTime={value}>{value}</time>,
    },
  ];
  const filtered = Object.entries(view.filters).some(([key, value]) => (
    key !== "cursor" && key !== "limit" && value !== null
  ));

  return (
    <section className="data-page" aria-labelledby="audit-title">
      <header className="page-heading">
        <h1 id="audit-title">{t("audit.title")}</h1>
        <span>{t("audit.description")}</span>
      </header>
      <form className="filter-bar audit-filter" method="get" action="/audit">
        <FilterInput name="kind" label={t("audit.kind")} value={view.filters.kind} />
        <FilterInput name="actorUserId" label={t("audit.actorUserId")} value={view.filters.actorUserId} />
        <FilterInput name="targetUserId" label={t("audit.targetUserId")} value={view.filters.targetUserId} />
        <FilterInput name="organizationId" label={t("audit.organizationId")} value={view.filters.organizationId} />
        <FilterInput name="commandId" label={t("audit.commandId")} value={view.filters.commandId} />
        <FilterInput name="createdAfter" label={t("audit.createdAfter")} value={view.filters.createdAfter} />
        <FilterInput name="createdBefore" label={t("audit.createdBefore")} value={view.filters.createdBefore} />
        <input type="hidden" name="limit" value={view.filters.limit} />
        <Button htmlType="submit" type="primary">{t("audit.applyFilters")}</Button>
      </form>
      {view.items.length === 0 ? <PageState kind={filtered ? "filtered-empty" : "empty"} /> : (
        <div className="data-table" role="region" aria-label={t("audit.title")} tabIndex={0}>
          <Table<AuditEventView>
            rowKey="id"
            columns={columns}
            dataSource={[...view.items]}
            pagination={false}
            scroll={{ x: 2_480 }}
          />
        </div>
      )}
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(auditHref(view.filters, cursor))}
      />
    </section>
  );
}

function FilterInput({
  name,
  label,
  value,
}: Readonly<{ name: string; label: string; value: string | null }>): React.ReactElement {
  return (
    <label className="audit-filter-field">
      <span>{label}</span>
      <input type="text" name={name} aria-label={label} defaultValue={value ?? ""} />
    </label>
  );
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

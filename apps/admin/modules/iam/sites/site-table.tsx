"use client";

import { DeleteOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { ModalForm, ProFormCheckbox, ProFormSelect, ProFormText, ProFormTextArea } from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button, Space } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { AdminTable } from "@/components/data/admin-table";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { CommandResult } from "@/components/feedback/command-result";
import { PageState } from "@/components/feedback/page-state";
import { AdminQueryFilter } from "@/components/forms/admin-query-filter";
import { AdminPage } from "@/components/platform/admin-page";
import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/messages";
import type { CommandActionResult } from "@/lib/command-result";

import { siteCodeSchema, siteNameSchema, type SiteCommandActionInput, type SiteListItem, type SiteListView } from "./schema";
import { siteListHref } from "./url";

export type SiteAction = (input: SiteCommandActionInput) => Promise<CommandActionResult>;
type LifecycleOperation = "suspend" | "reactivate" | "delete" | "restore" | "select";
type CreateValues = { code: string; name: string; reason: string };

const lifecycleCopy: Record<LifecycleOperation, { label: MessageKey; title: MessageKey; danger: boolean; icon: React.ReactNode }> = {
  suspend: { label: "site.suspend", title: "site.suspendTitle", danger: true, icon: <PauseCircleOutlined /> },
  reactivate: { label: "site.reactivate", title: "site.reactivateTitle", danger: false, icon: <PlayCircleOutlined /> },
  delete: { label: "site.delete", title: "site.deleteTitle", danger: true, icon: <DeleteOutlined /> },
  restore: { label: "site.restore", title: "site.restoreTitle", danger: false, icon: <UndoOutlined /> },
  select: { label: "site.select", title: "site.selectTitle", danger: false, icon: <PlayCircleOutlined /> },
};

export function SiteLifecycleControls({ site, action, includeSelect = false }: Readonly<{ site: SiteListItem; action: SiteAction; includeSelect?: boolean }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState<{ operation: LifecycleOperation; commandId: string } | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const operations: LifecycleOperation[] = site.status === "deleted"
    ? ["restore"]
    : site.status === "suspended" ? ["reactivate", "delete"] : [...(includeSelect ? ["select" as const] : []), "suspend", "delete"];

  async function confirm(reason: string): Promise<void> {
    if (pending === null) return;
    const response = await action({ operation: pending.operation, siteId: site.id, expectedVersion: site.version, requestId: crypto.randomUUID(), commandId: pending.commandId, reason });
    setResult(response);
    if (response.status === "success") { setPending(null); router.refresh(); }
  }

  return <>
    <Space size={4} wrap>{operations.map((operation) => <Button
      key={operation}
      aria-label={t(lifecycleCopy[operation].label)}
      danger={lifecycleCopy[operation].danger}
      icon={lifecycleCopy[operation].icon}
      size="small"
      type="text"
      onClick={() => { setResult(null); setPending({ operation, commandId: crypto.randomUUID() }); }}
    >{t(lifecycleCopy[operation].label)}</Button>)}</Space>
    {pending === null ? <CommandResult result={result} /> : <CommandDialog
      open title={t(lifecycleCopy[pending.operation].title)} entityLabel={site.name}
      danger={lifecycleCopy[pending.operation].danger} result={result}
      onCancel={() => setPending(null)} onConfirm={confirm}
    />}
  </>;
}

function CreateSiteDialog({ action, onClose }: Readonly<{ action: SiteAction; onClose(): void }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [locked, setLocked] = useState<Readonly<CreateValues> | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  async function submit(values: CreateValues): Promise<boolean> {
    const payload = locked ?? Object.freeze({ code: values.code.trim(), name: values.name.trim(), reason: values.reason.trim() });
    if (locked === null) setLocked(payload);
    const response = await action({ operation: "create", ...payload, requestId: crypto.randomUUID(), commandId });
    setResult(response);
    if (response.status === "success") { onClose(); router.refresh(); return true; }
    return false;
  }
  return <ModalForm<CreateValues>
    open title={t("site.createTitle")} width={520} initialValues={{ code: "", name: "", reason: "" }}
    modalProps={{ destroyOnHidden: true, onCancel: onClose }}
    submitter={{ searchConfig: { submitText: t("site.confirmCreate"), resetText: t("command.cancel") }, submitButtonProps: { "aria-label": t("site.confirmCreate") }, resetButtonProps: { onClick: onClose } }}
    onFinish={submit}
  >
    <ProFormText name="code" label={t("site.code")} disabled={locked !== null} fieldProps={{ maxLength: 80, "aria-label": t("site.code") }} rules={[{ required: true, message: t("site.codeInvalid") }, { validator: async (_, value: string) => siteCodeSchema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error(t("site.codeInvalid"))) }]} />
    <ProFormText name="name" label={t("site.name")} disabled={locked !== null} fieldProps={{ maxLength: 160, "aria-label": t("site.name") }} rules={[{ required: true, message: t("site.nameRequired") }, { validator: async (_, value: string) => siteNameSchema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error(t("site.nameRequired"))) }]} />
    <ProFormTextArea name="reason" label={t("command.reason")} disabled={locked !== null} fieldProps={{ rows: 3, maxLength: 500, "aria-label": t("command.reason") }} rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]} />
    <CommandResult result={result} />
  </ModalForm>;
}

export function SiteTable({ view, action }: Readonly<{ view: SiteListView; action: SiteAction }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [creating, setCreating] = useState(false);
  const columns: ProColumns<SiteListItem>[] = [
    { title: t("site.name"), dataIndex: "name", render: (_, site) => <Link href={`/sites/${site.id}`}>{site.name}</Link> },
    { title: t("site.code"), dataIndex: "code", className: "technical-value" },
    { title: t("site.status"), dataIndex: "status", width: 110, render: (_, site) => <StatusTag status={site.status} /> },
    { title: t("site.version"), dataIndex: "version", width: 90, className: "technical-value" },
    { title: t("site.updatedAt"), dataIndex: "updatedAt", width: 190, render: (_, site) => <time dateTime={site.updatedAt}>{site.updatedAt}</time> },
    { title: t("site.actions"), key: "actions", width: 260, render: (_, site) => <SiteLifecycleControls site={site} action={action} includeSelect /> },
  ];
  const initial = { query: view.filters.query, status: view.filters.status, includeDeleted: view.filters.includeDeleted };
  const navigate = (values: typeof initial) => router.push(siteListHref({ ...view.filters, query: values.query ?? "", status: values.status ?? "all", includeDeleted: values.includeDeleted ?? false, cursor: null }));
  const filtered = view.filters.query.length > 0 || view.filters.status !== "all" || view.filters.includeDeleted;
  return <AdminPage titleId="sites-title" title={t("site.title")} description={t("site.description")} extra={<Button type="primary" icon={<PlusOutlined />} aria-label={t("site.create")} onClick={() => setCreating(true)}>{t("site.create")}</Button>}>
    <AdminQueryFilter ariaLabel={t("site.applyFilters")} initialValues={initial} searchText={t("site.applyFilters")} resetText={t("common.reset")} onSubmit={navigate} onReset={() => navigate({ query: "", status: "all", includeDeleted: false })}>
      <ProFormText name="query" label={t("site.search")} fieldProps={{ type: "search", "aria-label": t("site.search") }} />
      <ProFormSelect name="status" label={t("site.filterStatus")} fieldProps={{ "aria-label": t("site.filterStatus") }} options={[{ value: "all", label: t("common.all") }, { value: "active", label: t("status.active") }, { value: "suspended", label: t("status.suspended") }, { value: "deleted", label: t("status.deleted") }]} />
      <ProFormCheckbox name="includeDeleted">{t("site.includeDeleted")}</ProFormCheckbox>
    </AdminQueryFilter>
    <AdminTable ariaLabel={t("site.title")} columns={columns} data={view.items} emptyText={<PageState kind={filtered ? "filtered-empty" : "empty"} />} rowKey="id" scrollX={1120} />
    <CursorPagination canGoBack={view.filters.cursor !== null} nextCursor={view.nextCursor} onPrevious={() => router.back()} onNext={(cursor) => router.push(siteListHref(view.filters, cursor))} />
    {creating ? <CreateSiteDialog action={action} onClose={() => setCreating(false)} /> : null}
  </AdminPage>;
}

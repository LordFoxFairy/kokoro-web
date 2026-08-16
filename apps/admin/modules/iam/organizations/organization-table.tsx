"use client";

import { DeleteOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { commandErrorKey } from "@/components/feedback/command-error";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import {
  organizationNameSchema,
  organizationSlugSchema,
  type OrganizationCommandActionInput,
  type OrganizationListItem,
  type OrganizationListView,
} from "./schema";
import { organizationListHref } from "./url";

export type OrganizationAction = (input: OrganizationCommandActionInput) => Promise<CommandActionResult>;
type LifecycleOperation = "delete" | "restore";
type CreateOrganizationPayload = Readonly<{ slug: string; name: string; reason: string }>;

function CommandResult({ result }: Readonly<{ result: CommandActionResult | null }>): React.ReactElement | null {
  const t = useT();
  if (result === null) return null;
  return result.status === "error" ? (
    <Alert
      className="command-result"
      type="error"
      showIcon
      title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
      description={result.requestId.length > 0 ? result.requestId : undefined}
    />
  ) : (
    <Alert
      className="command-result"
      type="success"
      showIcon
      title={t(result.replayed ? "action.replayed" : "action.success")}
    />
  );
}

export function OrganizationLifecycleControls({
  organization,
  action,
}: Readonly<{ organization: OrganizationListItem; action: OrganizationAction }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState<Readonly<{ operation: LifecycleOperation; commandId: string }> | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const operation: LifecycleOperation = organization.status === "deleted" ? "restore" : "delete";

  async function confirm(reason: string): Promise<void> {
    if (pending === null) return;
    const response = await action({
      operation: pending.operation,
      organizationId: organization.id,
      requestId: crypto.randomUUID(),
      commandId: pending.commandId,
      reason,
      expectedVersion: organization.version,
    });
    setResult(response);
    if (response.status === "success") {
      setPending(null);
      router.refresh();
    }
  }

  return (
    <>
      <Button
        aria-label={t(operation === "delete" ? "organization.delete" : "organization.restore")}
        danger={operation === "delete"}
        icon={operation === "delete" ? <DeleteOutlined /> : <UndoOutlined />}
        size="small"
        type="text"
        onClick={() => {
          setResult(null);
          setPending({ operation, commandId: crypto.randomUUID() });
        }}
      >
        {t(operation === "delete" ? "organization.delete" : "organization.restore")}
      </Button>
      {pending === null ? <CommandResult result={result} /> : null}
      {pending === null ? null : (
        <CommandDialog
          open
          title={t(pending.operation === "delete" ? "organization.deleteTitle" : "organization.restoreTitle")}
          entityLabel={organization.name}
          danger={pending.operation === "delete"}
          result={result}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

function OrganizationCreateDialog({
  open,
  action,
  onClose,
}: Readonly<{ open: boolean; action: OrganizationAction; onClose(): void }>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const slugId = useId();
  const nameId = useId();
  const reasonId = useId();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Readonly<{ slug: boolean; name: boolean; reason: boolean }>>({
    slug: false,
    name: false,
    reason: false,
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [lockedPayload, setLockedPayload] = useState<CreateOrganizationPayload | null>(null);

  async function confirm(): Promise<void> {
    let payload = lockedPayload;
    if (payload === null) {
      const invalid = {
        slug: !organizationSlugSchema.safeParse(slug).success,
        name: !organizationNameSchema.safeParse(name).success,
        reason: reason.trim().length === 0,
      };
      setErrors(invalid);
      if (Object.values(invalid).some(Boolean)) return;
      payload = Object.freeze({ slug: slug.trim(), name: name.trim(), reason: reason.trim() });
      setLockedPayload(payload);
    }
    setPending(true);
    try {
      const response = await action({
        operation: "create",
        slug: payload.slug,
        name: payload.name,
        reason: payload.reason,
        requestId: crypto.randomUUID(),
        commandId,
      });
      setResult(response);
      if (response.status === "success") {
        onClose();
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t("organization.createTitle")}
      onCancel={onClose}
      destroyOnHidden
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={pending}>{t("command.cancel")}</Button>,
        <Button
          key="create"
          aria-label={t("organization.confirmCreate")}
          type="primary"
          loading={pending}
          onClick={confirm}
        >
          {t("organization.confirmCreate")}
        </Button>,
      ]}
    >
      <div className="form-stack">
        <label htmlFor={slugId}>{t("organization.slug")}</label>
        <Input
          id={slugId}
          value={slug}
          disabled={lockedPayload !== null}
          maxLength={80}
          status={errors.slug ? "error" : undefined}
          onChange={(event) => setSlug(event.target.value)}
        />
        {errors.slug ? <span className="field-error" role="alert">{t("organization.slugInvalid")}</span> : null}
        <label htmlFor={nameId}>{t("organization.name")}</label>
        <Input
          id={nameId}
          value={name}
          disabled={lockedPayload !== null}
          maxLength={160}
          status={errors.name ? "error" : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {errors.name ? <span className="field-error" role="alert">{t("organization.nameRequired")}</span> : null}
        <label htmlFor={reasonId}>{t("command.reason")}</label>
        <Input.TextArea
          id={reasonId}
          value={reason}
          disabled={lockedPayload !== null}
          maxLength={500}
          rows={3}
          status={errors.reason ? "error" : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {errors.reason ? <span className="field-error" role="alert">{t("command.reasonRequired")}</span> : null}
        <CommandResult result={result} />
      </div>
    </Modal>
  );
}

export function OrganizationTable({ view, action }: Readonly<{
  view: OrganizationListView;
  action: OrganizationAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const columns: ColumnsType<OrganizationListItem> = [
    {
      title: t("organization.name"),
      dataIndex: "name",
      render: (_, organization) => <Link href={`/organizations/${organization.id}`}>{organization.name}</Link>,
    },
    { title: t("organization.slug"), dataIndex: "slug", className: "technical-value" },
    { title: t("organization.status"), dataIndex: "status", width: 110, render: (status: string) => <StatusTag status={status} /> },
    { title: t("organization.version"), dataIndex: "version", width: 90, className: "technical-value" },
    { title: t("organization.createdAt"), dataIndex: "createdAt", width: 190, render: (value: string) => <time dateTime={value}>{value}</time> },
    {
      title: t("organization.actions"),
      key: "actions",
      width: 150,
      render: (_, organization) => <OrganizationLifecycleControls organization={organization} action={action} />,
    },
  ];
  const filtered = view.filters.query.length > 0 || view.filters.status !== "all" || view.filters.includeDeleted;

  return (
    <section className="data-page" aria-labelledby="organizations-title">
      <header className="page-heading detail-heading">
        <div>
          <h1 id="organizations-title">{t("organization.title")}</h1>
          <span>{t("organization.description")}</span>
        </div>
        <Button aria-label={t("organization.create")} type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          {t("organization.create")}
        </Button>
      </header>
      <form className="filter-bar" method="get" action="/organizations">
        <label className="filter-search">
          <span>{t("organization.search")}</span>
          <input type="search" name="query" aria-label={t("organization.search")} defaultValue={view.filters.query} />
        </label>
        <label>
          <span>{t("organization.filterStatus")}</span>
          <select name="status" aria-label={t("organization.filterStatus")} defaultValue={view.filters.status}>
            <option value="all">{t("common.all")}</option>
            <option value="active">{t("status.active")}</option>
            <option value="suspended">{t("status.suspended")}</option>
            <option value="deleted">{t("status.deleted")}</option>
          </select>
        </label>
        <label className="filter-checkbox">
          <input type="checkbox" name="includeDeleted" value="true" defaultChecked={view.filters.includeDeleted} />
          <span>{t("organization.includeDeleted")}</span>
        </label>
        <input type="hidden" name="limit" value={view.filters.limit} />
        <Button htmlType="submit" type="primary">{t("organization.applyFilters")}</Button>
      </form>
      {view.items.length === 0 ? (
        <PageState kind={filtered ? "filtered-empty" : "empty"} />
      ) : (
        <div className="data-table" role="region" aria-label={t("organization.title")} tabIndex={0}>
          <Table<OrganizationListItem> rowKey="id" columns={columns} dataSource={[...view.items]} pagination={false} scroll={{ x: 980 }} />
        </div>
      )}
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(organizationListHref(view.filters, cursor))}
      />
      {creating ? <OrganizationCreateDialog open action={action} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}

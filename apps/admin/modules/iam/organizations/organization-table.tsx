"use client";

import { DeleteOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import {
  ModalForm,
  ProFormCheckbox,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button } from "antd";
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
import type { CommandActionResult } from "@/lib/command-result";

import {
  organizationNameSchema,
  organizationSlugSchema,
  type OrganizationCommandActionInput,
  type OrganizationFilters,
  type OrganizationListItem,
  type OrganizationListView,
} from "./schema";
import { organizationListHref } from "./url";

export type OrganizationAction = (input: OrganizationCommandActionInput) => Promise<CommandActionResult>;
type LifecycleOperation = "delete" | "restore";
type CreateOrganizationPayload = Readonly<{ slug: string; name: string; reason: string }>;
type CreateOrganizationValues = { slug: string; name: string; reason: string };

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
  const [commandId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [lockedPayload, setLockedPayload] = useState<CreateOrganizationPayload | null>(null);

  async function confirm(values: CreateOrganizationValues): Promise<boolean> {
    let payload = lockedPayload;
    if (payload === null) {
      payload = Object.freeze({
        slug: values.slug.trim(),
        name: values.name.trim(),
        reason: values.reason.trim(),
      });
      setLockedPayload(payload);
    }
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
      return true;
    }
    return false;
  }

  return (
    <ModalForm<CreateOrganizationValues>
      open={open}
      title={t("organization.createTitle")}
      width={520}
      initialValues={{ slug: "", name: "", reason: "" }}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      submitter={{
        searchConfig: { submitText: t("organization.confirmCreate"), resetText: t("command.cancel") },
        submitButtonProps: { "aria-label": t("organization.confirmCreate") },
        resetButtonProps: { onClick: onClose },
      }}
      onFinish={confirm}
    >
      <ProFormText
        name="slug"
        label={t("organization.slug")}
        disabled={lockedPayload !== null}
        fieldProps={{ maxLength: 80, "aria-label": t("organization.slug") }}
        rules={[
          { required: true, message: t("organization.slugInvalid") },
          {
            validator: async (_, value: string) => organizationSlugSchema.safeParse(value).success
              ? Promise.resolve()
              : Promise.reject(new Error(t("organization.slugInvalid"))),
          },
        ]}
      />
      <ProFormText
        name="name"
        label={t("organization.name")}
        disabled={lockedPayload !== null}
        fieldProps={{ maxLength: 160, "aria-label": t("organization.name") }}
        rules={[
          { required: true, message: t("organization.nameRequired") },
          {
            validator: async (_, value: string) => organizationNameSchema.safeParse(value).success
              ? Promise.resolve()
              : Promise.reject(new Error(t("organization.nameRequired"))),
          },
        ]}
      />
      <ProFormTextArea
        name="reason"
        label={t("command.reason")}
        disabled={lockedPayload !== null}
        fieldProps={{ maxLength: 500, rows: 3, "aria-label": t("command.reason") }}
        rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]}
      />
      <CommandResult result={result} />
    </ModalForm>
  );
}

export function OrganizationTable({ view, action }: Readonly<{
  view: OrganizationListView;
  action: OrganizationAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const columns: ProColumns<OrganizationListItem>[] = [
    {
      title: t("organization.name"),
      dataIndex: "name",
      render: (_, organization) => <Link href={`/organizations/${organization.id}`}>{organization.name}</Link>,
    },
    { title: t("organization.slug"), dataIndex: "slug", className: "technical-value" },
    { title: t("organization.status"), dataIndex: "status", width: 110, render: (_, organization) => <StatusTag status={organization.status} /> },
    { title: t("organization.version"), dataIndex: "version", width: 90, className: "technical-value" },
    { title: t("organization.createdAt"), dataIndex: "createdAt", width: 190, render: (_, organization) => <time dateTime={organization.createdAt}>{organization.createdAt}</time> },
    {
      title: t("organization.actions"),
      key: "actions",
      width: 150,
      render: (_, organization) => <OrganizationLifecycleControls organization={organization} action={action} />,
    },
  ];
  const filtered = view.filters.query.length > 0 || view.filters.status !== "all" || view.filters.includeDeleted;
  const initialFilters = {
    query: view.filters.query,
    status: view.filters.status,
    includeDeleted: view.filters.includeDeleted,
  };

  function navigateWithFilters(values: typeof initialFilters): void {
    const filters: OrganizationFilters = {
      ...view.filters,
      query: values.query ?? "",
      status: values.status ?? "all",
      includeDeleted: values.includeDeleted ?? false,
      cursor: null,
    };
    router.push(organizationListHref(filters));
  }

  return (
    <AdminPage
      titleId="organizations-title"
      title={t("organization.title")}
      description={t("organization.description")}
      extra={(
        <Button aria-label={t("organization.create")} type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          {t("organization.create")}
        </Button>
      )}
    >
      <AdminQueryFilter
        ariaLabel={t("organization.applyFilters")}
        initialValues={initialFilters}
        searchText={t("organization.applyFilters")}
        resetText={t("common.reset")}
        onSubmit={navigateWithFilters}
        onReset={() => navigateWithFilters({ query: "", status: "all", includeDeleted: false })}
      >
        <ProFormText
          name="query"
          label={t("organization.search")}
          fieldProps={{ type: "search", "aria-label": t("organization.search") }}
        />
        <ProFormSelect
          name="status"
          label={t("organization.filterStatus")}
          fieldProps={{ "aria-label": t("organization.filterStatus") }}
          options={[
            { value: "all", label: t("common.all") },
            { value: "active", label: t("status.active") },
            { value: "suspended", label: t("status.suspended") },
            { value: "deleted", label: t("status.deleted") },
          ]}
        />
        <ProFormCheckbox name="includeDeleted">{t("organization.includeDeleted")}</ProFormCheckbox>
      </AdminQueryFilter>
      <AdminTable<OrganizationListItem>
        ariaLabel={t("organization.title")}
        columns={columns}
        data={view.items}
        emptyText={<PageState kind={filtered ? "filtered-empty" : "empty"} />}
        rowKey="id"
        scrollX={980}
      />
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(organizationListHref(view.filters, cursor))}
      />
      {creating ? <OrganizationCreateDialog open action={action} onClose={() => setCreating(false)} /> : null}
    </AdminPage>
  );
}

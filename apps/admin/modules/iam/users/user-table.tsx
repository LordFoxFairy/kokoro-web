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

import { userEmailSchema, userImageSchema, userNameSchema, type UserCommandActionInput, type UserFilters, type UserListItem, type UserListView } from "./schema";
import { userListHref } from "./url";

export type UserAction = (input: UserCommandActionInput) => Promise<CommandActionResult>;
type Operation = "suspend" | "reactivate" | "delete" | "restore";
type PendingCommand = Readonly<{ operation: Operation; user: UserListItem; commandId: string }>;

const operationCopy: Readonly<Record<Operation, Readonly<{
  label: MessageKey;
  title: MessageKey;
  danger: boolean;
  icon: React.ReactNode;
}>>> = {
  suspend: { label: "user.suspend", title: "user.suspendTitle", danger: true, icon: <PauseCircleOutlined /> },
  reactivate: { label: "user.reactivate", title: "user.reactivateTitle", danger: false, icon: <PlayCircleOutlined /> },
  delete: { label: "user.delete", title: "user.deleteTitle", danger: true, icon: <DeleteOutlined /> },
  restore: { label: "user.restore", title: "user.restoreTitle", danger: false, icon: <UndoOutlined /> },
};

type UserEditorValues = { email: string; name: string; image?: string; reason: string };

export function UserEditorDialog({ user, action, onClose }: Readonly<{
  user?: UserListItem;
  action: UserAction;
  onClose(): void;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [locked, setLocked] = useState<Readonly<UserEditorValues> | null>(null);
  const updating = user !== undefined;

  async function submit(values: UserEditorValues): Promise<boolean> {
    let payload = locked;
    if (payload === null) {
      payload = Object.freeze({ email: values.email.trim(), name: values.name.trim(), image: values.image?.trim() ?? "", reason: values.reason.trim() });
      setLocked(payload);
    }
    const identity = { requestId: crypto.randomUUID(), commandId, reason: payload.reason };
    const response = await action(updating
      ? { operation: "update", userId: user.id, email: payload.email, name: payload.name, image: payload.image, expectedVersion: user.version, ...identity }
      : { operation: "create", email: payload.email, name: payload.name, image: payload.image, ...identity });
    setResult(response);
    if (response.status !== "success") return false;
    onClose();
    router.refresh();
    return true;
  }

  return (
    <ModalForm<UserEditorValues>
      open
      title={t(updating ? "user.updateTitle" : "user.createTitle")}
      width={520}
      initialValues={{ email: user?.email ?? "", name: user?.name ?? "", image: user?.image ?? "", reason: "" }}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      submitter={{
        searchConfig: { submitText: t(updating ? "user.confirmUpdate" : "user.confirmCreate"), resetText: t("command.cancel") },
        resetButtonProps: { onClick: onClose },
      }}
      onFinish={submit}
    >
      <ProFormText name="email" label={t("user.email")} disabled={locked !== null} fieldProps={{ maxLength: 320, "aria-label": t("user.email") }} rules={[{ required: true, message: t("user.emailInvalid") }, { validator: async (_, value: string) => userEmailSchema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error(t("user.emailInvalid"))) }]} />
      <ProFormText name="name" label={t("user.name")} disabled={locked !== null} fieldProps={{ maxLength: 160, "aria-label": t("user.name") }} rules={[{ required: true, message: t("user.nameRequired") }, { validator: async (_, value: string) => userNameSchema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error(t("user.nameRequired"))) }]} />
      <ProFormText name="image" label={t("user.image")} disabled={locked !== null} fieldProps={{ maxLength: 2048, "aria-label": t("user.image") }} rules={[{ validator: async (_, value: string) => userImageSchema.safeParse(value ?? "").success ? Promise.resolve() : Promise.reject(new Error(t("user.imageInvalid"))) }]} />
      <ProFormTextArea name="reason" label={t("command.reason")} disabled={locked !== null} fieldProps={{ maxLength: 500, rows: 3, "aria-label": t("command.reason") }} rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]} />
      <CommandResult result={result} />
    </ModalForm>
  );
}

export function UserLifecycleControls({ user, action }: Readonly<{
  user: UserListItem;
  action: UserAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const operations: readonly Operation[] = user.status === "deleted"
    ? ["restore"]
    : user.status === "suspended" ? ["reactivate", "delete"] : ["suspend", "delete"];

  async function confirm(reason: string): Promise<void> {
    if (pending === null) return;
    const response = await action({
      operation: pending.operation,
      userId: pending.user.id,
      requestId: crypto.randomUUID(),
      commandId: pending.commandId,
      reason,
      expectedVersion: pending.user.version,
    });
    setResult(response);
    if (response.status === "success") {
      setPending(null);
      router.refresh();
    }
  }

  return (
    <>
      <Space size={4} wrap>
        {operations.map((operation) => {
          const copy = operationCopy[operation];
          return (
            <Button
              key={operation}
              aria-label={t(copy.label)}
              danger={copy.danger}
              icon={copy.icon}
              size="small"
              type="text"
              onClick={() => {
                setResult(null);
                setPending({ operation, user, commandId: crypto.randomUUID() });
              }}
            >
              {t(copy.label)}
            </Button>
          );
        })}
      </Space>
      {pending === null ? <CommandResult result={result} /> : null}
      {pending === null ? null : (
        <CommandDialog
          open
          title={t(operationCopy[pending.operation].title)}
          entityLabel={pending.user.email}
          danger={operationCopy[pending.operation].danger}
          result={result}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

export function UserTable({ view, action }: Readonly<{
  view: UserListView;
  action: UserAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const columns: ProColumns<UserListItem>[] = [
    {
      title: t("user.email"),
      dataIndex: "email",
      render: (_, user) => <Link href={`/users/${user.id}`}>{user.email}</Link>,
    },
    { title: t("user.name"), dataIndex: "name" },
    { title: t("user.role"), dataIndex: "platformRole", width: 120 },
    { title: t("user.status"), dataIndex: "status", width: 110, render: (_, user) => <StatusTag status={user.status} /> },
    { title: t("user.version"), dataIndex: "version", width: 90, className: "technical-value" },
    { title: t("user.createdAt"), dataIndex: "createdAt", width: 190, render: (_, user) => <time dateTime={user.createdAt}>{user.createdAt}</time> },
    {
      title: t("user.actions"),
      key: "actions",
      width: 220,
      render: (_, user) => <UserLifecycleControls user={user} action={action} />,
    },
  ];
  const filtered = view.filters.query.length > 0 || view.filters.status !== "all" || view.filters.platformRole !== "all" || view.filters.includeDeleted;
  const initialFilters = {
    query: view.filters.query,
    status: view.filters.status,
    platformRole: view.filters.platformRole,
    includeDeleted: view.filters.includeDeleted,
  };

  function navigateWithFilters(values: typeof initialFilters): void {
    const filters: UserFilters = {
      ...view.filters,
      query: values.query ?? "",
      status: values.status ?? "all",
      platformRole: values.platformRole ?? "all",
      includeDeleted: values.includeDeleted ?? false,
      cursor: null,
    };
    router.push(userListHref(filters));
  }

  return (
    <AdminPage titleId="users-title" title={t("user.title")} description={t("user.description")} extra={<Button aria-label={t("user.create")} type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t("user.create")}</Button>}>
      <AdminQueryFilter
        ariaLabel={t("user.applyFilters")}
        initialValues={initialFilters}
        searchText={t("user.applyFilters")}
        resetText={t("common.reset")}
        onSubmit={navigateWithFilters}
        onReset={() => navigateWithFilters({ query: "", status: "all", platformRole: "all", includeDeleted: false })}
      >
        <ProFormText
          name="query"
          label={t("user.search")}
          fieldProps={{ type: "search", "aria-label": t("user.search") }}
        />
        <ProFormSelect
          name="status"
          label={t("user.filterStatus")}
          fieldProps={{ "aria-label": t("user.filterStatus") }}
          options={[
            { value: "all", label: t("common.all") },
            { value: "active", label: t("status.active") },
            { value: "suspended", label: t("status.suspended") },
            { value: "deleted", label: t("status.deleted") },
          ]}
        />
        <ProFormSelect name="platformRole" label={t("user.filterRole")} fieldProps={{ "aria-label": t("user.filterRole") }} options={[{ value: "all", label: t("common.all") }, { value: "user", label: t("user.roleUser") }, { value: "admin", label: t("user.roleAdmin") }]} />
        <ProFormCheckbox name="includeDeleted">{t("user.includeDeleted")}</ProFormCheckbox>
      </AdminQueryFilter>
      <AdminTable<UserListItem>
        ariaLabel={t("user.title")}
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
        onNext={(cursor) => router.push(userListHref(view.filters, cursor))}
      />
      {creating ? <UserEditorDialog action={action} onClose={() => setCreating(false)} /> : null}
    </AdminPage>
  );
}

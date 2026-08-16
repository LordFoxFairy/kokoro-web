"use client";

import { DeleteOutlined, PauseCircleOutlined, PlayCircleOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { commandErrorKey } from "@/components/feedback/command-error";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/messages";
import type { CommandActionResult } from "@/lib/command-result";

import type { UserCommandActionInput, UserListItem, UserListView } from "./schema";
import { userListHref } from "./url";

export type UserAction = (input: UserCommandActionInput) => Promise<CommandActionResult>;
type Operation = UserCommandActionInput["operation"];
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
      {pending === null && result?.status === "error" ? (
        <Alert
          className="command-result"
          type="error"
          showIcon
          title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
          description={result.requestId.length > 0 ? result.requestId : undefined}
        />
      ) : null}
      {pending === null && result?.status === "success" ? (
        <Alert
          className="command-result"
          type="success"
          showIcon
          title={t(result.replayed ? "action.replayed" : "action.success")}
        />
      ) : null}
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
  const columns: ColumnsType<UserListItem> = [
    {
      title: t("user.email"),
      dataIndex: "email",
      render: (_, user) => <Link href={`/users/${user.id}`}>{user.email}</Link>,
    },
    { title: t("user.name"), dataIndex: "name" },
    { title: t("user.role"), dataIndex: "platformRole", width: 120 },
    { title: t("user.status"), dataIndex: "status", width: 110, render: (status: string) => <StatusTag status={status} /> },
    { title: t("user.version"), dataIndex: "version", width: 90, className: "technical-value" },
    { title: t("user.createdAt"), dataIndex: "createdAt", width: 190, render: (value: string) => <time dateTime={value}>{value}</time> },
    {
      title: t("user.actions"),
      key: "actions",
      width: 220,
      render: (_, user) => <UserLifecycleControls user={user} action={action} />,
    },
  ];
  const filtered = view.filters.query.length > 0 || view.filters.status !== "all" || view.filters.includeDeleted;

  return (
    <section className="data-page" aria-labelledby="users-title">
      <header className="page-heading">
        <h1 id="users-title">{t("user.title")}</h1>
        <span>{t("user.description")}</span>
      </header>
      <form className="filter-bar" method="get" action="/users">
        <label className="filter-search">
          <span>{t("user.search")}</span>
          <input type="search" name="query" aria-label={t("user.search")} defaultValue={view.filters.query} />
        </label>
        <label>
          <span>{t("user.filterStatus")}</span>
          <select
            name="status"
            aria-label={t("user.filterStatus")}
            defaultValue={view.filters.status}
          >
            <option value="all">{t("common.all")}</option>
            <option value="active">{t("status.active")}</option>
            <option value="suspended">{t("status.suspended")}</option>
            <option value="deleted">{t("status.deleted")}</option>
          </select>
        </label>
        <label className="filter-checkbox">
          <input type="checkbox" name="includeDeleted" value="true" defaultChecked={view.filters.includeDeleted} />
          <span>{t("user.includeDeleted")}</span>
        </label>
        <input type="hidden" name="limit" value={view.filters.limit} />
        <Button htmlType="submit" type="primary">{t("user.applyFilters")}</Button>
      </form>
      {view.items.length === 0 ? (
        <PageState kind={filtered ? "filtered-empty" : "empty"} />
      ) : (
        <div className="data-table" role="region" aria-label={t("user.title")} tabIndex={0}>
          <Table<UserListItem> rowKey="id" columns={columns} dataSource={[...view.items]} pagination={false} scroll={{ x: 980 }} />
        </div>
      )}
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(userListHref(view.filters, cursor))}
      />
    </section>
  );
}

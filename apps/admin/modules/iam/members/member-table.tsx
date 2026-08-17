"use client";

import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  StopOutlined,
  SwapOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormCheckbox,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button, Select, Space, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { AdminTable } from "@/components/data/admin-table";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { CommandResult } from "@/components/feedback/command-result";
import { PageState } from "@/components/feedback/page-state";
import { AdminQueryFilter } from "@/components/forms/admin-query-filter";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import {
  roleKeySchema,
  type MemberFilters,
  type MemberListItem,
  type MemberListView,
  type RoleKey,
  type RoleOption,
} from "../organizations/schema";
import { organizationDetailHref } from "../organizations/url";
import type { MemberCommandActionInput } from "./schema";

export type MemberAction = (input: MemberCommandActionInput) => Promise<CommandActionResult>;
type MemberOperation = "change-role" | "suspend" | "reactivate" | "remove" | "restore";
type PendingCommand = Readonly<{ operation: MemberOperation; commandId: string; roleKey?: RoleKey }>;
type AddMemberPayload = Readonly<{ userId: string; roleKey: RoleKey; reason: string }>;
type AddMemberValues = { userId: string; roleKey: RoleKey; reason: string };

function MemberControls({
  organizationId,
  member,
  roles,
  action,
}: Readonly<{
  organizationId: string;
  member: MemberListItem;
  roles: readonly RoleOption[];
  action: MemberAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [roleKey, setRoleKey] = useState(member.roleKey);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const operations: readonly MemberOperation[] = member.status === "deleted"
    ? ["restore"]
    : member.status === "suspended" ? ["reactivate", "remove"] : ["suspend", "remove"];

  async function confirm(reason: string): Promise<void> {
    if (pending === null) return;
    const identity = {
      organizationId,
      memberId: member.id,
      requestId: crypto.randomUUID(),
      commandId: pending.commandId,
      reason,
      expectedVersion: member.version,
    };
    const response = pending.operation === "change-role"
      ? await action({ ...identity, operation: "change-role", roleKey: pending.roleKey ?? member.roleKey })
      : await action({ ...identity, operation: pending.operation });
    setResult(response);
    if (response.status === "success") {
      setPending(null);
      router.refresh();
    }
  }

  const labels = {
    "change-role": "member.changeRole",
    suspend: "member.suspend",
    reactivate: "member.reactivate",
    remove: "member.remove",
    restore: "member.restore",
  } as const;
  const titles = {
    "change-role": "member.changeRoleTitle",
    suspend: "member.suspendTitle",
    reactivate: "member.reactivateTitle",
    remove: "member.removeTitle",
    restore: "member.restoreTitle",
  } as const;

  return (
    <>
      {member.status === "deleted" ? null : (
        <Space.Compact size="small">
          <Select<RoleKey>
            aria-label={t("member.currentRole")}
            value={roleKey}
            size="small"
            style={{ minWidth: 132 }}
            options={roles.map((role) => ({ value: role.key, label: role.name }))}
            onChange={(value) => {
              const parsed = roleKeySchema.safeParse(value);
              if (parsed.success) setRoleKey(parsed.data);
            }}
          />
          <Button
            aria-label={t("member.changeRole")}
            icon={<SwapOutlined />}
            disabled={roleKey === member.roleKey}
            onClick={() => {
              setResult(null);
              setPending({ operation: "change-role", roleKey, commandId: crypto.randomUUID() });
            }}
          >
            {t("member.changeRole")}
          </Button>
        </Space.Compact>
      )}
      <Space size={4} wrap>
        {operations.map((operation) => (
          <Button
            key={operation}
            aria-label={t(labels[operation])}
            danger={operation === "suspend" || operation === "remove"}
            icon={operation === "suspend"
              ? <PauseCircleOutlined />
              : operation === "reactivate" ? <PlayCircleOutlined />
              : operation === "remove" ? <StopOutlined /> : <UndoOutlined />}
            size="small"
            type="text"
            onClick={() => {
              setResult(null);
              setPending({ operation, commandId: crypto.randomUUID() });
            }}
          >
            {t(labels[operation])}
          </Button>
        ))}
      </Space>
      {pending === null ? <CommandResult result={result} /> : null}
      {pending === null ? null : (
        <CommandDialog
          open
          title={t(titles[pending.operation])}
          entityLabel={member.userLabel}
          danger={pending.operation === "suspend" || pending.operation === "remove"}
          result={result}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

function AddMemberDialog({
  open,
  organizationId,
  view,
  action,
  onClose,
}: Readonly<{
  open: boolean;
  organizationId: string;
  view: MemberListView;
  action: MemberAction;
  onClose(): void;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [lockedPayload, setLockedPayload] = useState<AddMemberPayload | null>(null);

  async function confirm(values: AddMemberValues): Promise<boolean> {
    let payload = lockedPayload;
    if (payload === null) {
      payload = Object.freeze({
        userId: values.userId,
        roleKey: values.roleKey,
        reason: values.reason.trim(),
      });
      setLockedPayload(payload);
    }
    const response = await action({
      operation: "add",
      organizationId,
      userId: payload.userId,
      roleKey: payload.roleKey,
      requestId: crypto.randomUUID(),
      commandId,
      reason: payload.reason,
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
    <ModalForm<AddMemberValues>
      open={open}
      title={t("member.addTitle")}
      width={520}
      initialValues={{
        userId: view.userOptions[0]?.id ?? "",
        roleKey: view.roleOptions[0]?.key,
        reason: "",
      }}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      submitter={{
        searchConfig: { submitText: t("member.confirmAdd"), resetText: t("command.cancel") },
        submitButtonProps: { "aria-label": t("member.confirmAdd") },
        resetButtonProps: { onClick: onClose },
      }}
      onFinish={confirm}
    >
      <ProFormSelect
        name="userId"
        label={t("member.user")}
        disabled={lockedPayload !== null}
        fieldProps={{ "aria-label": t("member.user") }}
        rules={[{ required: true, message: t("member.userRequired") }]}
        options={view.userOptions.map((user) => ({ value: user.id, label: `${user.email} · ${user.name}` }))}
      />
      <ProFormSelect
        name="roleKey"
        label={t("member.role")}
        disabled={lockedPayload !== null}
        fieldProps={{ "aria-label": t("member.role") }}
        rules={[{ required: true, message: t("member.roleRequired") }]}
        options={view.roleOptions.map((role) => ({ value: role.key, label: role.name }))}
      />
      <ProFormTextArea
        name="reason"
        label={t("command.reason")}
        disabled={lockedPayload !== null}
        fieldProps={{ rows: 3, maxLength: 500, "aria-label": t("command.reason") }}
        rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]}
      />
      <CommandResult result={result} />
    </ModalForm>
  );
}

export function MemberTable({ organizationId, view, action }: Readonly<{
  organizationId: string;
  view: MemberListView;
  action: MemberAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const columns: ProColumns<MemberListItem>[] = [
    { title: t("member.user"), dataIndex: "userLabel", width: 260 },
    { title: t("member.userId"), dataIndex: "userId", width: 300, className: "technical-value" },
    { title: t("member.role"), dataIndex: "roleKey", width: 130, className: "technical-value" },
    { title: t("member.status"), dataIndex: "status", width: 110, render: (_, member) => <StatusTag status={member.status} /> },
    { title: t("member.version"), dataIndex: "version", width: 90, className: "technical-value" },
    {
      title: t("member.actions"),
      key: "actions",
      width: 420,
      render: (_, member) => <MemberControls organizationId={organizationId} member={member} roles={view.roleOptions} action={action} />,
    },
  ];
  const roleColumns: ProColumns<RoleOption>[] = [
    { title: t("member.role"), dataIndex: "name" },
    { title: t("common.description"), dataIndex: "description" },
    { title: t("access.rolePermissions"), dataIndex: "permissionKeys", render: (_, role) => role.permissionKeys.join(", ") },
    { title: t("member.builtIn"), dataIndex: "builtIn", width: 130, render: (_, role) => role.builtIn ? <Tag color="green">{t("member.builtIn")}</Tag> : t("common.none") },
  ];
  const initialFilters = {
    query: view.filters.query ?? "",
    includeDeleted: view.filters.includeDeleted,
  };

  function navigateWithFilters(values: typeof initialFilters): void {
    const filters: MemberFilters = {
      ...view.filters,
      query: values.query ?? "",
      includeDeleted: values.includeDeleted ?? false,
      cursor: null,
    };
    router.push(organizationDetailHref(organizationId, filters));
  }

  return (
    <section className="member-section" aria-labelledby="members-title">
      <div className="section-heading">
        <div>
          <h2 id="members-title">{t("member.title")}</h2>
          <p>{t("member.description")}</p>
        </div>
        <Button
          aria-label={t("member.add")}
          type="primary"
          icon={<PlusOutlined />}
          disabled={view.userOptions.length === 0 || view.roleOptions.length === 0}
          onClick={() => setAdding(true)}
        >
          {t("member.add")}
        </Button>
      </div>
      <AdminQueryFilter
        ariaLabel={t("member.applyFilters")}
        initialValues={initialFilters}
        searchText={t("member.applyFilters")}
        resetText={t("common.reset")}
        onSubmit={navigateWithFilters}
        onReset={() => navigateWithFilters({ query: "", includeDeleted: false })}
      >
        <ProFormText
          name="query"
          label={t("member.searchUser")}
          fieldProps={{ type: "search", "aria-label": t("member.searchUser") }}
        />
        <ProFormCheckbox name="includeDeleted">{t("member.includeDeleted")}</ProFormCheckbox>
      </AdminQueryFilter>
      <AdminTable<MemberListItem>
        ariaLabel={t("member.title")}
        columns={columns}
        data={view.items}
        emptyText={<PageState kind={view.filters.includeDeleted ? "filtered-empty" : "empty"} />}
        rowKey="id"
        scrollX={1_320}
      />
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(organizationDetailHref(organizationId, view.filters, cursor))}
      />
      <section className="catalog-section" aria-labelledby="member-role-catalog-title">
        <div className="section-heading"><h3 id="member-role-catalog-title">{t("member.roleCatalog")}</h3></div>
        <AdminTable<RoleOption>
          ariaLabel={t("member.roleCatalog")}
          columns={roleColumns}
          data={view.roleOptions}
          emptyText={<PageState kind="empty" />}
          rowKey="key"
        />
      </section>
      {adding ? <AddMemberDialog open organizationId={organizationId} view={view} action={action} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

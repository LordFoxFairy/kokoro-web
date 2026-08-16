"use client";

import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  StopOutlined,
  SwapOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Alert, Button, Input, Modal, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
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
  roleKeySchema,
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

function ResultAlert({ result }: Readonly<{ result: CommandActionResult | null }>): React.ReactElement | null {
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
    <Alert className="command-result" type="success" showIcon title={t(result.replayed ? "action.replayed" : "action.success")} />
  );
}

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
          <select
            aria-label={t("member.currentRole")}
            value={roleKey}
            onChange={(event) => {
              const parsed = roleKeySchema.safeParse(event.target.value);
              if (parsed.success) setRoleKey(parsed.data);
            }}
          >
            {roles.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
          </select>
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
      {pending === null ? <ResultAlert result={result} /> : null}
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
  const userIdField = useId();
  const roleField = useId();
  const reasonField = useId();
  const [userId, setUserId] = useState(view.userOptions[0]?.id ?? "");
  const [roleKey, setRoleKey] = useState<RoleKey | null>(view.roleOptions[0]?.key ?? null);
  const [reason, setReason] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState({ user: false, role: false, reason: false });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [lockedPayload, setLockedPayload] = useState<AddMemberPayload | null>(null);

  async function confirm(): Promise<void> {
    let payload = lockedPayload;
    if (payload === null) {
      const invalid = { user: userId.length === 0, role: roleKey === null, reason: reason.trim().length === 0 };
      setErrors(invalid);
      if (Object.values(invalid).some(Boolean) || roleKey === null) return;
      payload = Object.freeze({ userId, roleKey, reason: reason.trim() });
      setLockedPayload(payload);
    }
    setPending(true);
    try {
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
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t("member.addTitle")}
      onCancel={onClose}
      destroyOnHidden
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={pending}>{t("command.cancel")}</Button>,
        <Button key="add" aria-label={t("member.confirmAdd")} type="primary" loading={pending} onClick={confirm}>
          {t("member.confirmAdd")}
        </Button>,
      ]}
    >
      <div className="form-stack">
        <label htmlFor={userIdField}>{t("member.user")}</label>
        <select id={userIdField} value={userId} disabled={lockedPayload !== null} onChange={(event) => setUserId(event.target.value)}>
          <option value="">{t("common.none")}</option>
          {view.userOptions.map((user) => (
            <option key={user.id} value={user.id}>{user.email} · {user.name}</option>
          ))}
        </select>
        {errors.user ? <span className="field-error" role="alert">{t("member.userRequired")}</span> : null}
        <label htmlFor={roleField}>{t("member.role")}</label>
        <select
          id={roleField}
          value={roleKey ?? ""}
          disabled={lockedPayload !== null}
          onChange={(event) => {
            const parsed = roleKeySchema.safeParse(event.target.value);
            setRoleKey(parsed.success ? parsed.data : null);
          }}
        >
          <option value="">{t("common.none")}</option>
          {view.roleOptions.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
        </select>
        {errors.role ? <span className="field-error" role="alert">{t("member.roleRequired")}</span> : null}
        <label htmlFor={reasonField}>{t("command.reason")}</label>
        <Input.TextArea
          id={reasonField}
          value={reason}
          disabled={lockedPayload !== null}
          rows={3}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
        {errors.reason ? <span className="field-error" role="alert">{t("command.reasonRequired")}</span> : null}
        <ResultAlert result={result} />
      </div>
    </Modal>
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
  const columns: ColumnsType<MemberListItem> = [
    { title: t("member.user"), dataIndex: "userLabel", width: 260 },
    { title: t("member.userId"), dataIndex: "userId", width: 300, className: "technical-value" },
    { title: t("member.role"), dataIndex: "roleKey", width: 130, className: "technical-value" },
    { title: t("member.status"), dataIndex: "status", width: 110, render: (status: string) => <StatusTag status={status} /> },
    { title: t("member.version"), dataIndex: "version", width: 90, className: "technical-value" },
    {
      title: t("member.actions"),
      key: "actions",
      width: 420,
      render: (_, member) => <MemberControls organizationId={organizationId} member={member} roles={view.roleOptions} action={action} />,
    },
  ];
  const roleColumns: ColumnsType<RoleOption> = [
    { title: t("member.role"), dataIndex: "name" },
    { title: t("common.description"), dataIndex: "description" },
    { title: t("access.rolePermissions"), dataIndex: "permissionKeys", render: (keys: readonly string[]) => keys.join(", ") },
    { title: t("member.builtIn"), dataIndex: "builtIn", width: 130, render: (builtIn: boolean) => builtIn ? <Tag color="green">{t("member.builtIn")}</Tag> : t("common.none") },
  ];

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
      <form className="filter-bar member-filter" method="get" action={`/organizations/${organizationId}`}>
        <label className="filter-search">
          <span>{t("member.searchUser")}</span>
          <input type="search" name="memberQuery" aria-label={t("member.searchUser")} defaultValue={view.filters.query ?? ""} />
        </label>
        <label className="filter-checkbox">
          <input type="checkbox" name="includeDeletedMembers" value="true" defaultChecked={view.filters.includeDeleted} />
          <span>{t("member.includeDeleted")}</span>
        </label>
        <input type="hidden" name="memberLimit" value={view.filters.limit} />
        <Button htmlType="submit">{t("member.applyFilters")}</Button>
      </form>
      {view.items.length === 0 ? (
        <PageState kind={view.filters.includeDeleted ? "filtered-empty" : "empty"} />
      ) : (
        <div className="data-table" role="region" aria-label={t("member.title")} tabIndex={0}>
          <Table<MemberListItem> rowKey="id" columns={columns} dataSource={[...view.items]} pagination={false} scroll={{ x: 1320 }} />
        </div>
      )}
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(organizationDetailHref(organizationId, view.filters, cursor))}
      />
      <section className="catalog-section" aria-labelledby="member-role-catalog-title">
        <div className="section-heading"><h3 id="member-role-catalog-title">{t("member.roleCatalog")}</h3></div>
        <div className="data-table" role="region" aria-label={t("member.roleCatalog")} tabIndex={0}>
          <Table<RoleOption> rowKey="key" columns={roleColumns} dataSource={[...view.roleOptions]} pagination={false} />
        </div>
      </section>
      {adding ? <AddMemberDialog open organizationId={organizationId} view={view} action={action} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

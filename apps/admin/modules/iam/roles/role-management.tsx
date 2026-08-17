"use client";

import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { ModalForm, ProFormText, ProFormTextArea } from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button, Checkbox, Space, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { AdminTable } from "@/components/data/admin-table";
import { StatusTag } from "@/components/data/status-tag";
import { CommandResult } from "@/components/feedback/command-result";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import type {
  OrganizationPermissionGroup, OrganizationRoleCommandActionInput, OrganizationRoleItem,
  OrganizationRoleManagementView,
} from "./schema";

export type OrganizationRoleAction = (input: OrganizationRoleCommandActionInput) => Promise<CommandActionResult>;
type RoleFormValues = Readonly<{ key: string; name: string; description: string; reason: string }>;
type PendingLifecycle = Readonly<{ operation: "delete" | "restore"; role: OrganizationRoleItem; commandId: string }>;

function PermissionSelector({
  groups, value, disabled, onChange,
}: Readonly<{
  groups: readonly OrganizationPermissionGroup[];
  value: readonly string[];
  disabled: boolean;
  onChange(value: readonly string[]): void;
}>): React.ReactElement {
  const selected = new Set(value);
  return (
    <div className="permission-groups" aria-label="permissions">
      {groups.map((group) => (
        <fieldset key={group.resource} className="permission-group">
          <legend>{group.resource}</legend>
          <Space direction="vertical" size={4}>
            {group.permissions.map((permission) => (
              <Checkbox
                key={permission.key}
                checked={selected.has(permission.key)}
                disabled={disabled}
                aria-label={`${permission.key} · ${permission.description}`}
                onChange={(event) => onChange(event.target.checked
                  ? [...selected, permission.key].sort()
                  : [...selected].filter((key) => key !== permission.key).sort())}
              >
                <code>{permission.key}</code> <span className="secondary-text">{permission.description}</span>
              </Checkbox>
            ))}
          </Space>
        </fieldset>
      ))}
    </div>
  );
}

function RoleFormDialog({
  organizationId, role, groups, action, onClose,
}: Readonly<{
  organizationId: string;
  role: OrganizationRoleItem | null;
  groups: readonly OrganizationPermissionGroup[];
  action: OrganizationRoleAction;
  onClose(): void;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [permissions, setPermissions] = useState<readonly string[]>(role?.permissionKeys ?? []);
  const [locked, setLocked] = useState<Readonly<RoleFormValues & { permissionKeys: readonly string[] }> | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);

  async function confirm(values: RoleFormValues): Promise<boolean> {
    const payload = locked ?? Object.freeze({
      key: values.key.trim(), name: values.name.trim(), description: values.description.trim(),
      reason: values.reason.trim(), permissionKeys: Object.freeze([...permissions].sort()),
    });
    if (locked === null) setLocked(payload);
    const identity = { organizationId, requestId: crypto.randomUUID(), commandId, reason: payload.reason };
    const response = role === null
      ? await action({ ...identity, operation: "create", key: payload.key, name: payload.name, description: payload.description, permissionKeys: [...payload.permissionKeys] })
      : await action({ ...identity, operation: "update", roleId: role.id, name: payload.name, description: payload.description, expectedVersion: role.version });
    setResult(response);
    if (response.status === "success") { onClose(); router.refresh(); return true; }
    return false;
  }

  return (
    <ModalForm<RoleFormValues>
      open
      title={t(role === null ? "role.createTitle" : "role.updateTitle")}
      width={680}
      initialValues={{ key: role?.key ?? "", name: role?.name ?? "", description: role?.description ?? "", reason: "" }}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      submitter={{ searchConfig: { submitText: t("command.confirm"), resetText: t("command.cancel") }, resetButtonProps: { onClick: onClose } }}
      onFinish={confirm}
    >
      <ProFormText name="key" label={t("role.key")} disabled={role !== null || locked !== null} fieldProps={{ maxLength: 64 }} rules={[{ required: true, pattern: /^[a-z][a-z0-9_]{0,63}$/u, message: t("role.keyInvalid") }]} />
      <ProFormText name="name" label={t("role.name")} disabled={locked !== null} fieldProps={{ maxLength: 120 }} rules={[{ required: true, whitespace: true, message: t("role.nameRequired") }]} />
      <ProFormTextArea name="description" label={t("common.description")} disabled={locked !== null} fieldProps={{ maxLength: 500, rows: 3 }} rules={[{ required: true, whitespace: true, message: t("role.descriptionRequired") }]} />
      {role === null ? <PermissionSelector groups={groups} value={permissions} disabled={locked !== null} onChange={setPermissions} /> : null}
      <ProFormTextArea name="reason" label={t("command.reason")} disabled={locked !== null} fieldProps={{ maxLength: 500, rows: 3, "aria-label": t("command.reason") }} rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]} />
      <CommandResult result={result} />
    </ModalForm>
  );
}

function PermissionDialog({
  organizationId, role, groups, action, onClose,
}: Readonly<{
  organizationId: string;
  role: OrganizationRoleItem;
  groups: readonly OrganizationPermissionGroup[];
  action: OrganizationRoleAction;
  onClose(): void;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [permissions, setPermissions] = useState<readonly string[]>(role.permissionKeys);
  const [locked, setLocked] = useState<Readonly<{ permissions: readonly string[]; reason: string }> | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);

  async function confirm(values: { reason: string }): Promise<boolean> {
    const payload = locked ?? Object.freeze({ permissions: Object.freeze([...permissions].sort()), reason: values.reason.trim() });
    if (locked === null) setLocked(payload);
    const response = await action({
      operation: "set-permissions", organizationId, roleId: role.id, expectedVersion: role.version,
      permissionKeys: [...payload.permissions], requestId: crypto.randomUUID(), commandId, reason: payload.reason,
    });
    setResult(response);
    if (response.status === "success") { onClose(); router.refresh(); return true; }
    return false;
  }

  return (
    <ModalForm<{ reason: string }>
      open title={t("role.permissionsTitle")} width={720} initialValues={{ reason: "" }}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      submitter={{ searchConfig: { submitText: t("role.savePermissions"), resetText: t("command.cancel") }, resetButtonProps: { onClick: onClose } }}
      onFinish={confirm}
    >
      <PermissionSelector groups={groups} value={permissions} disabled={locked !== null} onChange={setPermissions} />
      <ProFormTextArea name="reason" label={t("command.reason")} disabled={locked !== null} fieldProps={{ maxLength: 500, rows: 3, "aria-label": t("command.reason") }} rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]} />
      <CommandResult result={result} />
    </ModalForm>
  );
}

export function OrganizationRoleManagement({
  organizationId, view, action,
}: Readonly<{
  organizationId: string;
  view: OrganizationRoleManagementView;
  action: OrganizationRoleAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<OrganizationRoleItem | "create" | null>(null);
  const [permissionRole, setPermissionRole] = useState<OrganizationRoleItem | null>(null);
  const [pending, setPending] = useState<PendingLifecycle | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const columns: ProColumns<OrganizationRoleItem>[] = [
    { title: t("role.name"), dataIndex: "name", render: (_, role) => <Space size={6}>{role.name}{role.builtIn ? <Tag>{t("role.builtIn")}</Tag> : null}</Space> },
    { title: t("role.key"), dataIndex: "key", render: (_, role) => <code>{role.key}</code> },
    { title: t("role.status"), dataIndex: "status", width: 110, render: (_, role) => <StatusTag status={role.status} /> },
    { title: t("role.permissions"), dataIndex: "permissionKeys", width: 110, render: (_, role) => role.permissionKeys.length },
    { title: t("organization.actions"), valueType: "option", width: 300, render: (_, role) => role.builtIn ? <span className="secondary-text">{t("role.builtInReadonly")}</span> : (
      <Space size={4} wrap>
        {role.status === "active" ? (
          <>
            <Button size="small" type="text" icon={<EditOutlined />} aria-label={t("role.update")} onClick={() => setEditing(role)}>{t("role.update")}</Button>
            <Button size="small" type="text" icon={<KeyOutlined />} aria-label={t("role.configurePermissions")} onClick={() => setPermissionRole(role)}>{t("role.configurePermissions")}</Button>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={t("role.delete")} onClick={() => setPending({ operation: "delete", role, commandId: crypto.randomUUID() })}>{t("role.delete")}</Button>
          </>
        ) : <Button size="small" type="text" icon={<UndoOutlined />} aria-label={t("role.restore")} onClick={() => setPending({ operation: "restore", role, commandId: crypto.randomUUID() })}>{t("role.restore")}</Button>}
      </Space>
    ) },
  ];

  async function lifecycle(reason: string): Promise<void> {
    if (pending === null) return;
    const response = await action({
      operation: pending.operation, organizationId, roleId: pending.role.id, expectedVersion: pending.role.version,
      requestId: crypto.randomUUID(), commandId: pending.commandId, reason,
    });
    setResult(response);
    if (response.status === "success") { setPending(null); router.refresh(); }
  }

  return (
    <section aria-labelledby="organization-role-title">
      <div className="section-heading">
        <div><h2 id="organization-role-title">{t("role.title")}</h2><p>{t("role.description")}</p></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing("create")}>{t("role.create")}</Button>
      </div>
      <AdminTable ariaLabel={t("role.title")} columns={columns} data={view.items} emptyText={t("state.empty.title")} rowKey="id" scrollX={980} />
      {pending === null ? <CommandResult result={result} /> : <CommandDialog open title={t(pending.operation === "delete" ? "role.deleteTitle" : "role.restoreTitle")} entityLabel={pending.role.name} danger={pending.operation === "delete"} result={result} onCancel={() => setPending(null)} onConfirm={lifecycle} />}
      {editing === null ? null : <RoleFormDialog organizationId={organizationId} role={editing === "create" ? null : editing} groups={view.permissionGroups} action={action} onClose={() => setEditing(null)} />}
      {permissionRole === null ? null : <PermissionDialog organizationId={organizationId} role={permissionRole} groups={view.permissionGroups} action={action} onClose={() => setPermissionRole(null)} />}
    </section>
  );
}

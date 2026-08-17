"use client";

import { PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, StopOutlined, SwapOutlined, UndoOutlined } from "@ant-design/icons";
import { ModalForm, ProFormCheckbox, ProFormSelect, ProFormText, ProFormTextArea } from "@ant-design/pro-form";
import type { ProColumns } from "@ant-design/pro-table";
import { Button, Select, Space } from "antd";
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

import { siteRoleKeySchema, type SiteCommandActionInput, type SiteDetailFilters, type SiteMemberListItem, type SiteMemberListView } from "./schema";
import type { SiteAction } from "./site-table";
import { siteDetailHref } from "./url";

type MemberOperation = "change-member-role" | "suspend-member" | "reactivate-member" | "remove-member" | "restore-member";

function MemberControls({ siteId, member, view, action }: Readonly<{ siteId: string; member: SiteMemberListItem; view: SiteMemberListView; action: SiteAction }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [roleKey, setRoleKey] = useState(member.roleKey);
  const [pending, setPending] = useState<{ operation: MemberOperation; commandId: string } | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<SiteAction>> | null>(null);
  const operations: MemberOperation[] = member.status === "deleted" ? ["restore-member"] : member.status === "suspended" ? ["reactivate-member", "remove-member"] : ["suspend-member", "remove-member"];
  const labels = { "change-member-role": "siteMember.changeRole", "suspend-member": "siteMember.suspend", "reactivate-member": "siteMember.reactivate", "remove-member": "siteMember.remove", "restore-member": "siteMember.restore" } as const;
  const titles = { "change-member-role": "siteMember.changeRoleTitle", "suspend-member": "siteMember.suspendTitle", "reactivate-member": "siteMember.reactivateTitle", "remove-member": "siteMember.removeTitle", "restore-member": "siteMember.restoreTitle" } as const;
  async function confirm(reason: string): Promise<void> {
    if (pending === null) return;
    const identity = { siteId, memberId: member.id, expectedVersion: member.version, requestId: crypto.randomUUID(), commandId: pending.commandId, reason };
    const input: SiteCommandActionInput = pending.operation === "change-member-role" ? { ...identity, operation: pending.operation, roleKey } : { ...identity, operation: pending.operation };
    const response = await action(input); setResult(response);
    if (response.status === "success") { setPending(null); router.refresh(); }
  }
  return <>
    {member.status === "deleted" ? null : <Space.Compact size="small"><Select aria-label={t("siteMember.currentRole")} value={roleKey} style={{ minWidth: 116 }} options={view.roleOptions.map((role) => ({ value: role.key, label: role.label }))} onChange={(value) => { const parsed = siteRoleKeySchema.safeParse(value); if (parsed.success) setRoleKey(parsed.data); }} /><Button icon={<SwapOutlined />} disabled={roleKey === member.roleKey} aria-label={t("siteMember.changeRole")} onClick={() => setPending({ operation: "change-member-role", commandId: crypto.randomUUID() })}>{t("siteMember.changeRole")}</Button></Space.Compact>}
    <Space size={4} wrap>{operations.map((operation) => <Button key={operation} size="small" type="text" danger={operation === "suspend-member" || operation === "remove-member"} aria-label={t(labels[operation])} icon={operation === "suspend-member" ? <PauseCircleOutlined /> : operation === "reactivate-member" ? <PlayCircleOutlined /> : operation === "remove-member" ? <StopOutlined /> : <UndoOutlined />} onClick={() => { setResult(null); setPending({ operation, commandId: crypto.randomUUID() }); }}>{t(labels[operation])}</Button>)}</Space>
    {pending === null ? <CommandResult result={result} /> : <CommandDialog open title={t(titles[pending.operation])} entityLabel={member.userLabel} danger={pending.operation === "suspend-member" || pending.operation === "remove-member"} result={result} onCancel={() => setPending(null)} onConfirm={confirm} />}
  </>;
}

function AddMemberDialog({ siteId, view, action, onClose }: Readonly<{ siteId: string; view: SiteMemberListView; action: SiteAction; onClose(): void }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [commandId] = useState(() => crypto.randomUUID());
  const [locked, setLocked] = useState<{ userId: string; roleKey: "owner" | "admin" | "member"; reason: string } | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<SiteAction>> | null>(null);
  async function submit(values: { userId: string; roleKey: "owner" | "admin" | "member"; reason: string }): Promise<boolean> {
    const payload = locked ?? { ...values, reason: values.reason.trim() }; if (locked === null) setLocked(payload);
    const response = await action({ operation: "add-member", siteId, ...payload, requestId: crypto.randomUUID(), commandId }); setResult(response);
    if (response.status === "success") { onClose(); router.refresh(); return true; } return false;
  }
  return <ModalForm open title={t("siteMember.addTitle")} width={520} initialValues={{ userId: view.userOptions[0]?.id, roleKey: view.roleOptions[0]?.key, reason: "" }} modalProps={{ destroyOnHidden: true, onCancel: onClose }} submitter={{ searchConfig: { submitText: t("siteMember.confirmAdd"), resetText: t("command.cancel") }, submitButtonProps: { "aria-label": t("siteMember.confirmAdd") }, resetButtonProps: { onClick: onClose } }} onFinish={submit}>
    <ProFormSelect name="userId" label={t("siteMember.user")} disabled={locked !== null} fieldProps={{ "aria-label": t("siteMember.user") }} options={view.userOptions.map((user) => ({ value: user.id, label: `${user.email} · ${user.name}` }))} rules={[{ required: true, message: t("siteMember.userRequired") }]} />
    <ProFormSelect name="roleKey" label={t("siteMember.role")} disabled={locked !== null} fieldProps={{ "aria-label": t("siteMember.role") }} options={view.roleOptions.map((role) => ({ value: role.key, label: role.label }))} rules={[{ required: true, message: t("siteMember.roleRequired") }]} />
    <ProFormTextArea name="reason" label={t("command.reason")} disabled={locked !== null} fieldProps={{ maxLength: 500, rows: 3, "aria-label": t("command.reason") }} rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]} />
    <CommandResult result={result} />
  </ModalForm>;
}

export function SiteMembers({ siteId, view, filters, action }: Readonly<{ siteId: string; view: SiteMemberListView; filters: SiteDetailFilters; action: SiteAction }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [adding, setAdding] = useState(false);
  const columns: ProColumns<SiteMemberListItem>[] = [
    { title: t("siteMember.user"), dataIndex: "userLabel", width: 240 },
    { title: t("siteMember.userId"), dataIndex: "userId", width: 300, className: "technical-value" },
    { title: t("siteMember.role"), dataIndex: "roleKey", width: 120 },
    { title: t("siteMember.status"), dataIndex: "status", width: 110, render: (_, member) => <StatusTag status={member.status} /> },
    { title: t("siteMember.actions"), key: "actions", width: 430, render: (_, member) => <MemberControls siteId={siteId} member={member} view={view} action={action} /> },
  ];
  const navigate = (values: { memberQuery?: string; includeDeletedMembers?: boolean }) => router.push(siteDetailHref(siteId, { ...filters, tab: "members", memberQuery: values.memberQuery ?? "", includeDeletedMembers: values.includeDeletedMembers ?? false, memberCursor: null }));
  return <section aria-labelledby="site-members-title"><div className="section-heading"><h2 id="site-members-title">{t("siteMember.title")}</h2><Button type="primary" icon={<PlusOutlined />} aria-label={t("siteMember.add")} onClick={() => setAdding(true)}>{t("siteMember.add")}</Button></div>
    <AdminQueryFilter ariaLabel={t("siteMember.applyFilters")} initialValues={{ memberQuery: filters.memberQuery, includeDeletedMembers: filters.includeDeletedMembers }} searchText={t("siteMember.applyFilters")} resetText={t("common.reset")} onSubmit={navigate} onReset={() => navigate({ memberQuery: "", includeDeletedMembers: false })}>
      <ProFormText name="memberQuery" label={t("siteMember.searchUser")} fieldProps={{ type: "search", "aria-label": t("siteMember.searchUser") }} />
      <ProFormCheckbox name="includeDeletedMembers">{t("siteMember.includeDeleted")}</ProFormCheckbox>
    </AdminQueryFilter>
    <AdminTable ariaLabel={t("siteMember.title")} columns={columns} data={view.items} emptyText={<PageState kind="empty" />} rowKey="id" scrollX={1210} />
    <CursorPagination canGoBack={filters.memberCursor !== null} nextCursor={view.nextCursor} onPrevious={() => router.back()} onNext={(cursor) => router.push(siteDetailHref(siteId, { ...filters, tab: "members" }, cursor))} />
    {adding ? <AddMemberDialog siteId={siteId} view={view} action={action} onClose={() => setAdding(false)} /> : null}
  </section>;
}

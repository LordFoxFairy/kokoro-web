"use client";

import { EditOutlined } from "@ant-design/icons";
import { ModalForm, ProFormText, ProFormTextArea } from "@ant-design/pro-form";
import { ProDescriptions } from "@ant-design/pro-descriptions";
import { Alert, Button, Space, Tabs } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusTag } from "@/components/data/status-tag";
import { CommandResult } from "@/components/feedback/command-result";
import { AdminPage } from "@/components/platform/admin-page";
import { useT } from "@/i18n/context";

import { siteDetailFiltersSchema, siteNameSchema, type SiteDetailView } from "./schema";
import { SiteAccess } from "./site-access";
import { SiteAudit } from "./site-audit";
import { SiteMembers } from "./site-members";
import { SiteRoles, type SiteRoleAction } from "./site-roles";
import { SiteLifecycleControls, type SiteAction } from "./site-table";
import { siteDetailHref } from "./url";

function UpdateSiteDialog({ view, action, onClose }: Readonly<{ view: SiteDetailView; action: SiteAction; onClose(): void }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [commandId] = useState(() => crypto.randomUUID());
  const [locked, setLocked] = useState<{ name: string; reason: string } | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<SiteAction>> | null>(null);
  async function submit(values: { name: string; reason: string }): Promise<boolean> {
    const payload = locked ?? { name: values.name.trim(), reason: values.reason.trim() }; if (locked === null) setLocked(payload);
    const response = await action({ operation: "update", siteId: view.site.id, ...payload, expectedVersion: view.site.version, requestId: crypto.randomUUID(), commandId }); setResult(response);
    if (response.status === "success") { onClose(); router.refresh(); return true; } return false;
  }
  return <ModalForm open title={t("site.updateTitle")} width={520} initialValues={{ name: view.site.name, reason: "" }} modalProps={{ destroyOnHidden: true, onCancel: onClose }} submitter={{ searchConfig: { submitText: t("site.confirmUpdate"), resetText: t("command.cancel") }, submitButtonProps: { "aria-label": t("site.confirmUpdate") }, resetButtonProps: { onClick: onClose } }} onFinish={submit}>
    <ProFormText name="name" label={t("site.name")} disabled={locked !== null} fieldProps={{ maxLength: 160, "aria-label": t("site.name") }} rules={[{ required: true, message: t("site.nameRequired") }, { validator: async (_, value: string) => siteNameSchema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error(t("site.nameRequired"))) }]} />
    <ProFormTextArea name="reason" label={t("command.reason")} disabled={locked !== null} fieldProps={{ maxLength: 500, rows: 3, "aria-label": t("command.reason") }} rules={[{ required: true, whitespace: true, message: t("command.reasonRequired") }]} />
    <CommandResult result={result} />
  </ModalForm>;
}

export function SiteDetail({ view, action, roleAction }: Readonly<{ view: SiteDetailView; action: SiteAction; roleAction: SiteRoleAction }>): React.ReactElement {
  const t = useT(); const router = useRouter(); const [updating, setUpdating] = useState(false); const deleted = view.site.status === "deleted";
  return <AdminPage titleId="site-detail-title" title={view.site.name} description={`${t("site.detail")} · ${view.site.code}`} extra={<Space wrap>{deleted ? null : <Button icon={<EditOutlined />} onClick={() => setUpdating(true)}>{t("site.update")}</Button>}<SiteLifecycleControls site={view.site} action={action} includeSelect /></Space>}>
    {deleted ? <Alert className="site-deleted-alert" type="warning" showIcon title={t("site.deletedNotice")} description={t("site.deletedDescription")} /> : null}
    <Tabs className="admin-detail-tabs site-detail-tabs" activeKey={view.filters.tab} destroyOnHidden={false} onChange={(tab) => { const parsed = siteDetailFiltersSchema.shape.tab.safeParse(tab); if (parsed.success) router.push(siteDetailHref(view.site.id, { ...view.filters, tab: parsed.data })); }} items={[
      { key: "overview", label: t("site.tab.overview"), children: <ProDescriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}><ProDescriptions.Item label="ID"><code>{view.site.id}</code></ProDescriptions.Item><ProDescriptions.Item label={t("site.code")}><code>{view.site.code}</code></ProDescriptions.Item><ProDescriptions.Item label={t("site.name")}>{view.site.name}</ProDescriptions.Item><ProDescriptions.Item label={t("site.status")}><StatusTag status={view.site.status} /></ProDescriptions.Item><ProDescriptions.Item label={t("site.version")}><code>{view.site.version}</code></ProDescriptions.Item><ProDescriptions.Item label={t("site.createdAt")}><time dateTime={view.site.createdAt}>{view.site.createdAt}</time></ProDescriptions.Item><ProDescriptions.Item label={t("site.updatedAt")}><time dateTime={view.site.updatedAt}>{view.site.updatedAt}</time></ProDescriptions.Item></ProDescriptions> },
      { key: "members", label: t("site.tab.members"), children: <SiteMembers siteId={view.site.id} view={view.members} filters={view.filters} action={action} /> },
      { key: "roles", label: t("site.tab.roles"), children: <SiteRoles siteId={view.site.id} view={view.roles} action={roleAction} /> },
      { key: "access", label: t("site.tab.access"), children: <SiteAccess siteId={view.site.id} permissionKeys={view.permissionKeys} members={view.members} filters={view.filters} authorization={view.authorization} /> },
      { key: "audit", label: t("site.tab.audit"), children: <SiteAudit siteId={view.site.id} audit={view.audit} filters={view.filters} /> },
    ]} />
    {updating ? <UpdateSiteDialog view={view} action={action} onClose={() => setUpdating(false)} /> : null}
  </AdminPage>;
}

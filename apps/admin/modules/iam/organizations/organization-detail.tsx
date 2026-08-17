"use client";

import { EditOutlined } from "@ant-design/icons";
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
} from "@ant-design/pro-form";
import { ProDescriptions } from "@ant-design/pro-descriptions";
import type { ProColumns } from "@ant-design/pro-table";
import { Alert, Button, Space, Tabs } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminTable } from "@/components/data/admin-table";
import { StatusTag } from "@/components/data/status-tag";
import { commandErrorKey } from "@/components/feedback/command-error";
import { AdminPage } from "@/components/platform/admin-page";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import { MemberTable, type MemberAction } from "../members/member-table";
import { OrganizationRoleManagement, type OrganizationRoleAction } from "../roles/role-management";
import { organizationNameSchema, type OrganizationDetailView } from "./schema";
import { OrganizationLifecycleControls, type OrganizationAction } from "./organization-table";

type UpdateOrganizationValues = { name: string; reason: string };

function OrganizationUpdateDialog({
  open,
  view,
  action,
  onClose,
}: Readonly<{
  open: boolean;
  view: OrganizationDetailView;
  action: OrganizationAction;
  onClose(): void;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [lockedPayload, setLockedPayload] = useState<Readonly<{ name: string; reason: string }> | null>(null);

  async function confirm(values: UpdateOrganizationValues): Promise<boolean> {
    let payload = lockedPayload;
    if (payload === null) {
      payload = Object.freeze({ name: values.name.trim(), reason: values.reason.trim() });
      setLockedPayload(payload);
    }
    const response = await action({
      operation: "update",
      organizationId: view.organization.id,
      name: payload.name,
      expectedVersion: view.organization.version,
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
    <ModalForm<UpdateOrganizationValues>
      open={open}
      title={t("organization.updateTitle")}
      width={520}
      initialValues={{ name: view.organization.name, reason: "" }}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      submitter={{
        searchConfig: { submitText: t("organization.confirmUpdate"), resetText: t("command.cancel") },
        submitButtonProps: { "aria-label": t("organization.confirmUpdate") },
        resetButtonProps: { onClick: onClose },
      }}
      onFinish={confirm}
    >
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
      {result?.status === "error" ? (
        <Alert
          type="error"
          showIcon
          title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
          description={result.requestId.length > 0 ? result.requestId : undefined}
        />
      ) : null}
    </ModalForm>
  );
}

export function OrganizationDetail({
  view,
  organizationAction,
  memberAction,
  roleAction,
}: Readonly<{
  view: OrganizationDetailView;
  organizationAction: OrganizationAction;
  memberAction: MemberAction;
  roleAction: OrganizationRoleAction;
}>): React.ReactElement {
  const t = useT();
  const [updating, setUpdating] = useState(false);
  const eventColumns: ProColumns<OrganizationDetailView["events"][number]>[] = [
    { title: t("event.kind"), dataIndex: "kind" },
    { title: t("event.requestId"), dataIndex: "requestId", width: 300, className: "technical-value" },
    { title: t("event.commandId"), dataIndex: "commandId", width: 300, className: "technical-value", render: (_, event) => event.commandId ?? t("common.none") },
    { title: t("organization.createdAt"), dataIndex: "createdAt", width: 190, render: (_, event) => <time dateTime={event.createdAt}>{event.createdAt}</time> },
  ];

  return (
    <AdminPage
      titleId="organization-detail-title"
      title={t("organization.detail")}
      description={`${view.organization.name} · ${view.organization.slug}`}
      extra={(
        <Space wrap>
          {view.organization.status === "deleted" ? null : (
            <Button icon={<EditOutlined />} onClick={() => setUpdating(true)}>{t("organization.update")}</Button>
          )}
          <OrganizationLifecycleControls organization={view.organization} action={organizationAction} />
        </Space>
      )}
    >
      <Tabs
        className="admin-detail-tabs"
        items={[
          {
            key: "profile",
            label: t("common.profile"),
            children: (
              <ProDescriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
                <ProDescriptions.Item label="ID"><code>{view.organization.id}</code></ProDescriptions.Item>
                <ProDescriptions.Item label={t("organization.slug")}><code>{view.organization.slug}</code></ProDescriptions.Item>
                <ProDescriptions.Item label={t("organization.name")}>{view.organization.name}</ProDescriptions.Item>
                <ProDescriptions.Item label={t("organization.status")}><StatusTag status={view.organization.status} /></ProDescriptions.Item>
                <ProDescriptions.Item label={t("organization.version")}><code>{view.organization.version}</code></ProDescriptions.Item>
                <ProDescriptions.Item label={t("organization.createdAt")}><time dateTime={view.organization.createdAt}>{view.organization.createdAt}</time></ProDescriptions.Item>
                <ProDescriptions.Item label={t("organization.updatedAt")}><time dateTime={view.organization.updatedAt}>{view.organization.updatedAt}</time></ProDescriptions.Item>
              </ProDescriptions>
            ),
          },
          {
            key: "members",
            label: t("member.title"),
            children: <MemberTable organizationId={view.organization.id} view={view.members} action={memberAction} />,
          },
          {
            key: "roles",
            label: t("role.title"),
            children: <OrganizationRoleManagement organizationId={view.organization.id} view={view.roles} action={roleAction} />,
          },
          {
            key: "audit",
            label: t("common.audit"),
            children: (
              <section className="event-section" aria-labelledby="organization-events-title">
                <div className="section-heading"><h2 id="organization-events-title">{t("organization.events")}</h2></div>
                <AdminTable<OrganizationDetailView["events"][number]>
                  ariaLabel={t("organization.events")}
                  columns={eventColumns}
                  data={view.events}
                  emptyText={t("state.empty.title")}
                  rowKey="id"
                  scrollX={980}
                />
              </section>
            ),
          },
        ]}
      />
      {updating ? <OrganizationUpdateDialog open view={view} action={organizationAction} onClose={() => setUpdating(false)} /> : null}
    </AdminPage>
  );
}

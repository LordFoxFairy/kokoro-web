"use client";

import { EditOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Input, Modal, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { StatusTag } from "@/components/data/status-tag";
import { commandErrorKey } from "@/components/feedback/command-error";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import { MemberTable, type MemberAction } from "../members/member-table";
import { organizationNameSchema, type OrganizationDetailView } from "./schema";
import { OrganizationLifecycleControls, type OrganizationAction } from "./organization-table";

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
  const nameId = useId();
  const reasonId = useId();
  const [name, setName] = useState(view.organization.name);
  const [reason, setReason] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState({ name: false, reason: false });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [lockedPayload, setLockedPayload] = useState<Readonly<{ name: string; reason: string }> | null>(null);

  async function confirm(): Promise<void> {
    let payload = lockedPayload;
    if (payload === null) {
      const invalid = {
        name: !organizationNameSchema.safeParse(name).success,
        reason: reason.trim().length === 0,
      };
      setErrors(invalid);
      if (Object.values(invalid).some(Boolean)) return;
      payload = Object.freeze({ name: name.trim(), reason: reason.trim() });
      setLockedPayload(payload);
    }
    setPending(true);
    try {
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
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t("organization.updateTitle")}
      onCancel={onClose}
      destroyOnHidden
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={pending}>{t("command.cancel")}</Button>,
        <Button key="update" aria-label={t("organization.confirmUpdate")} type="primary" loading={pending} onClick={confirm}>
          {t("organization.confirmUpdate")}
        </Button>,
      ]}
    >
      <div className="form-stack">
        <label htmlFor={nameId}>{t("organization.name")}</label>
        <Input
          id={nameId}
          value={name}
          disabled={lockedPayload !== null}
          maxLength={160}
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
          onChange={(event) => setReason(event.target.value)}
        />
        {errors.reason ? <span className="field-error" role="alert">{t("command.reasonRequired")}</span> : null}
        {result?.status === "error" ? (
          <Alert
            type="error"
            showIcon
            title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
            description={result.requestId.length > 0 ? result.requestId : undefined}
          />
        ) : null}
      </div>
    </Modal>
  );
}

export function OrganizationDetail({
  view,
  organizationAction,
  memberAction,
}: Readonly<{
  view: OrganizationDetailView;
  organizationAction: OrganizationAction;
  memberAction: MemberAction;
}>): React.ReactElement {
  const t = useT();
  const [updating, setUpdating] = useState(false);
  const eventColumns: ColumnsType<OrganizationDetailView["events"][number]> = [
    { title: t("event.kind"), dataIndex: "kind" },
    { title: t("event.requestId"), dataIndex: "requestId", width: 300, className: "technical-value" },
    { title: t("event.commandId"), dataIndex: "commandId", width: 300, className: "technical-value", render: (value: string | null) => value ?? t("common.none") },
    { title: t("organization.createdAt"), dataIndex: "createdAt", width: 190, render: (value: string) => <time dateTime={value}>{value}</time> },
  ];

  return (
    <section className="data-page" aria-labelledby="organization-detail-title">
      <header className="page-heading detail-heading">
        <div>
          <h1 id="organization-detail-title">{t("organization.detail")}</h1>
          <span>{view.organization.name} · {view.organization.slug}</span>
        </div>
        <div>
          {view.organization.status === "deleted" ? null : (
            <Button icon={<EditOutlined />} onClick={() => setUpdating(true)}>{t("organization.update")}</Button>
          )}
          <OrganizationLifecycleControls organization={view.organization} action={organizationAction} />
        </div>
      </header>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="ID"><code>{view.organization.id}</code></Descriptions.Item>
        <Descriptions.Item label={t("organization.slug")}><code>{view.organization.slug}</code></Descriptions.Item>
        <Descriptions.Item label={t("organization.name")}>{view.organization.name}</Descriptions.Item>
        <Descriptions.Item label={t("organization.status")}><StatusTag status={view.organization.status} /></Descriptions.Item>
        <Descriptions.Item label={t("organization.version")}><code>{view.organization.version}</code></Descriptions.Item>
        <Descriptions.Item label={t("organization.createdAt")}><time dateTime={view.organization.createdAt}>{view.organization.createdAt}</time></Descriptions.Item>
        <Descriptions.Item label={t("organization.updatedAt")}><time dateTime={view.organization.updatedAt}>{view.organization.updatedAt}</time></Descriptions.Item>
      </Descriptions>
      <MemberTable organizationId={view.organization.id} view={view.members} action={memberAction} />
      <section className="event-section" aria-labelledby="organization-events-title">
        <div className="section-heading"><h2 id="organization-events-title">{t("organization.events")}</h2></div>
        <div className="data-table" role="region" aria-label={t("organization.events")} tabIndex={0}>
          <Table
            rowKey="id"
            columns={eventColumns}
            dataSource={[...view.events]}
            pagination={false}
            locale={{ emptyText: t("state.empty.title") }}
            scroll={{ x: 980 }}
          />
        </div>
      </section>
      {updating ? <OrganizationUpdateDialog open view={view} action={organizationAction} onClose={() => setUpdating(false)} /> : null}
    </section>
  );
}

"use client";

import { ProDescriptions } from "@ant-design/pro-descriptions";
import type { ProColumns } from "@ant-design/pro-table";
import { EditOutlined } from "@ant-design/icons";
import { Button, Space, Tabs } from "antd";
import { useState } from "react";

import { AdminTable } from "@/components/data/admin-table";
import { StatusTag } from "@/components/data/status-tag";
import { AdminPage } from "@/components/platform/admin-page";
import { useT } from "@/i18n/context";

import { SessionTable, type SessionAction } from "../sessions/session-table";
import type { UserDetailView, UserEventView } from "./schema";
import { UserEditorDialog, UserLifecycleControls, type UserAction } from "./user-table";

export function UserDetail({
  view,
  userAction,
  sessionAction,
}: Readonly<{
  view: UserDetailView;
  userAction: UserAction;
  sessionAction: SessionAction;
}>): React.ReactElement {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const eventColumns: ProColumns<UserEventView>[] = [
    { title: t("event.kind"), dataIndex: "kind" },
    { title: t("event.requestId"), dataIndex: "requestId", width: 300, className: "technical-value" },
    { title: t("event.commandId"), dataIndex: "commandId", width: 300, className: "technical-value", render: (_, event) => event.commandId ?? t("common.none") },
    { title: t("user.createdAt"), dataIndex: "createdAt", width: 190, render: (_, event) => <time dateTime={event.createdAt}>{event.createdAt}</time> },
  ];

  return (
    <AdminPage
      titleId="user-detail-title"
      title={t("user.detail")}
      description={view.user.email}
      extra={<Space><Button icon={<EditOutlined />} disabled={view.user.status === "deleted"} onClick={() => setEditing(true)}>{t("user.update")}</Button><UserLifecycleControls user={view.user} action={userAction} /></Space>}
    >
      <Tabs
        className="admin-detail-tabs"
        items={[
          {
            key: "profile",
            label: t("common.profile"),
            children: (
              <ProDescriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
                <ProDescriptions.Item label="ID"><code>{view.user.id}</code></ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.email")}>{view.user.email}</ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.name")}>{view.user.name}</ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.role")}>{view.user.platformRole}</ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.status")}><StatusTag status={view.user.status} /></ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.version")}><code>{view.user.version}</code></ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.createdAt")}><time dateTime={view.user.createdAt}>{view.user.createdAt}</time></ProDescriptions.Item>
                <ProDescriptions.Item label={t("user.updatedAt")}><time dateTime={view.user.updatedAt}>{view.user.updatedAt}</time></ProDescriptions.Item>
              </ProDescriptions>
            ),
          },
          {
            key: "sessions",
            label: t("session.title"),
            children: <SessionTable view={view.sessions} action={sessionAction} embedded />,
          },
          {
            key: "audit",
            label: t("common.audit"),
            children: (
              <section className="event-section" aria-labelledby="user-events-title">
                <div className="section-heading"><h2 id="user-events-title">{t("user.events")}</h2></div>
                <AdminTable<UserEventView>
                  ariaLabel={t("user.events")}
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
      {editing ? <UserEditorDialog user={view.user} action={userAction} onClose={() => setEditing(false)} /> : null}
    </AdminPage>
  );
}

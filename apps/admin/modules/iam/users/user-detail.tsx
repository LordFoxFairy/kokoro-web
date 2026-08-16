"use client";

import { Descriptions, Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { StatusTag } from "@/components/data/status-tag";
import { useT } from "@/i18n/context";

import { SessionTable, type SessionAction } from "../sessions/session-table";
import type { UserDetailView, UserEventView } from "./schema";
import { UserLifecycleControls, type UserAction } from "./user-table";

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
  const eventColumns: ColumnsType<UserEventView> = [
    { title: t("event.kind"), dataIndex: "kind" },
    { title: t("event.requestId"), dataIndex: "requestId", width: 300, className: "technical-value" },
    { title: t("event.commandId"), dataIndex: "commandId", width: 300, className: "technical-value", render: (value: string | null) => value ?? t("common.none") },
    { title: t("user.createdAt"), dataIndex: "createdAt", width: 190, render: (value: string) => <time dateTime={value}>{value}</time> },
  ];

  return (
    <section className="data-page" aria-labelledby="user-detail-title">
      <header className="page-heading detail-heading">
        <div>
          <h1 id="user-detail-title">{t("user.detail")}</h1>
          <span>{view.user.email}</span>
        </div>
        <UserLifecycleControls user={view.user} action={userAction} />
      </header>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="ID"><code>{view.user.id}</code></Descriptions.Item>
        <Descriptions.Item label={t("user.email")}>{view.user.email}</Descriptions.Item>
        <Descriptions.Item label={t("user.name")}>{view.user.name}</Descriptions.Item>
        <Descriptions.Item label={t("user.role")}>{view.user.platformRole}</Descriptions.Item>
        <Descriptions.Item label={t("user.status")}><StatusTag status={view.user.status} /></Descriptions.Item>
        <Descriptions.Item label={t("user.version")}><code>{view.user.version}</code></Descriptions.Item>
        <Descriptions.Item label={t("user.createdAt")}><time dateTime={view.user.createdAt}>{view.user.createdAt}</time></Descriptions.Item>
        <Descriptions.Item label={t("user.updatedAt")}><time dateTime={view.user.updatedAt}>{view.user.updatedAt}</time></Descriptions.Item>
      </Descriptions>
      <SessionTable view={view.sessions} action={sessionAction} />
      <section className="event-section" aria-labelledby="user-events-title">
        <div className="section-heading">
          <h2 id="user-events-title">{t("user.events")}</h2>
        </div>
        <div className="data-table" role="region" aria-label={t("user.events")} tabIndex={0}>
          <Table<UserEventView>
            rowKey="id"
            columns={eventColumns}
            dataSource={[...view.events]}
            pagination={false}
            locale={{ emptyText: t("state.empty.title") }}
            scroll={{ x: 980 }}
          />
        </div>
      </section>
    </section>
  );
}

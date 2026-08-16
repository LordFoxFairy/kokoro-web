"use client";

import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { StatusTag } from "@/components/data/status-tag";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";

import type { OverviewState } from "./schema";

type RecentEvent = Extract<OverviewState, { status: "ready" }>["recentEvents"][number];

export function IamOverview({ state }: Readonly<{ state: OverviewState }>): React.ReactElement {
  const t = useT();
  const columns: ColumnsType<RecentEvent> = [
    { title: t("audit.kind"), dataIndex: "kind", className: "technical-value" },
    { title: t("audit.requestId"), dataIndex: "requestId", className: "technical-value" },
    { title: t("audit.commandId"), dataIndex: "commandId", className: "technical-value" },
    {
      title: t("audit.createdAt"),
      dataIndex: "createdAt",
      className: "technical-value",
      render: (value: string) => <time dateTime={value}>{value}</time>,
    },
  ];

  return (
    <section className="overview-page" aria-labelledby="overview-title">
      <header className="page-heading">
        <h1 id="overview-title">{t("overview.title")}</h1>
        <span>{t("overview.description")}</span>
      </header>
      {state.status !== "ready" ? <PageState kind={state.status} /> : (
        <>
          <div className="overview-grid">
            <article className="metric-panel">
              <span>{t("overview.iam")}</span>
              <strong><StatusTag status="active" /> {t("overview.ready")}</strong>
            </article>
            <article className="metric-panel">
              <span>{t("overview.operator")}</span>
              <strong>{state.administrator.email}</strong>
              <code>{state.administrator.id}</code>
            </article>
            <article className="metric-panel">
              <span>{t("overview.actorExpires")}</span>
              <time dateTime={state.actorExpiresAt}>{state.actorExpiresAt}</time>
            </article>
          </div>
          <section className="event-section" aria-labelledby="overview-events-title">
            <div className="section-heading"><h2 id="overview-events-title">{t("overview.recentEvents")}</h2></div>
            {state.recentEvents.length === 0 ? <PageState kind="empty" /> : (
              <div className="data-table" role="region" aria-label={t("overview.recentEvents")} tabIndex={0}>
                <Table<RecentEvent>
                  rowKey="id"
                  columns={columns}
                  dataSource={[...state.recentEvents]}
                  pagination={false}
                  scroll={{ x: 1_080 }}
                />
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

"use client";

import { AuditOutlined, KeyOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import type { ProColumns } from "@ant-design/pro-table";

import { AdminTable } from "@/components/data/admin-table";
import { StatusTag } from "@/components/data/status-tag";
import { PageState } from "@/components/feedback/page-state";
import { AdminPage } from "@/components/platform/admin-page";
import { AdminSection } from "@/components/platform/admin-section";
import { useT } from "@/i18n/context";

import type { OverviewState } from "./schema";

type RecentEvent = Extract<OverviewState, { status: "ready" }>["recentEvents"][number];

export function IamOverview({ state }: Readonly<{ state: OverviewState }>): React.ReactElement {
  const t = useT();
  const columns: ProColumns<RecentEvent>[] = [
    { title: t("audit.kind"), dataIndex: "kind", className: "technical-value" },
    { title: t("audit.requestId"), dataIndex: "requestId", className: "technical-value" },
    { title: t("audit.commandId"), dataIndex: "commandId", className: "technical-value" },
    {
      title: t("audit.createdAt"),
      dataIndex: "createdAt",
      className: "technical-value",
      render: (_, event) => <time dateTime={event.createdAt}>{event.createdAt}</time>,
    },
  ];

  return (
    <AdminPage titleId="overview-title" title={t("overview.title")} description={t("overview.description")}>
      {state.status !== "ready" ? <PageState kind={state.status} /> : (
        <>
          <div className="overview-grid">
            <article className="metric-panel">
              <span><span aria-hidden="true"><SafetyCertificateOutlined /></span>{t("overview.iam")}</span>
              <strong><StatusTag status="active" /> {t("overview.ready")}</strong>
            </article>
            <article className="metric-panel">
              <span><span aria-hidden="true"><UserOutlined /></span>{t("overview.operator")}</span>
              <strong>{state.administrator.email}</strong>
              <code>{state.administrator.id}</code>
            </article>
            <article className="metric-panel">
              <span><span aria-hidden="true"><KeyOutlined /></span>{t("overview.session")}</span>
              <strong>{t("overview.authenticated")}</strong>
            </article>
          </div>
          <AdminSection
            className="event-section"
            titleId="overview-events-title"
            title={t("overview.recentEvents")}
            icon={<AuditOutlined />}
          >
            <AdminTable<RecentEvent>
              ariaLabel={t("overview.recentEvents")}
              columns={columns}
              data={state.recentEvents}
              emptyText={<PageState kind="empty" />}
              rowKey="id"
              scrollX={1_080}
            />
          </AdminSection>
        </>
      )}
    </AdminPage>
  );
}

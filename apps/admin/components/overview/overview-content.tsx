"use client";

import { StatusTag } from "@/components/data/status-tag";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";

export type OverviewPresentationState =
  | Readonly<{
      status: "ready";
      administrator: Readonly<{ email: string; id: string }>;
      actorExpiresAt: string;
    }>
  | Readonly<{ status: "unavailable" }>;

export function OverviewContent({
  state,
}: Readonly<{ state: OverviewPresentationState }>): React.ReactElement {
  const t = useT();

  return (
    <section className="overview-page" aria-labelledby="overview-title">
      <header className="page-heading">
        <p>Identity &amp; Access Management</p>
        <h1 id="overview-title">{t("overview.title")}</h1>
        <span>{t("overview.description")}</span>
      </header>
      {state.status === "unavailable" ? (
        <PageState kind="unavailable" />
      ) : (
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
      )}
    </section>
  );
}

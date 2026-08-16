"use client";

import { LockOutlined, SearchOutlined, WarningOutlined } from "@ant-design/icons";
import { Empty, Result, Skeleton } from "antd";

import { useT } from "@/i18n/context";
import type { MessageKey } from "@/i18n/messages";

export type PageStateKind = "loading" | "empty" | "filtered-empty" | "forbidden" | "unavailable" | "malformed";

const stateCopy: Readonly<Record<PageStateKind, Readonly<{ title: MessageKey; description: MessageKey }>>> = {
  loading: { title: "state.loading.title", description: "state.loading.description" },
  empty: { title: "state.empty.title", description: "state.empty.description" },
  "filtered-empty": { title: "state.filteredEmpty.title", description: "state.filteredEmpty.description" },
  forbidden: { title: "state.forbidden.title", description: "state.forbidden.description" },
  unavailable: { title: "state.unavailable.title", description: "state.unavailable.description" },
  malformed: { title: "state.malformed.title", description: "state.malformed.description" },
};

export function PageState({ kind }: Readonly<{ kind: PageStateKind }>): React.ReactElement {
  const t = useT();
  const copy = stateCopy[kind];

  if (kind === "loading") {
    return (
      <section className="page-state" role="status" aria-live="polite" data-state={kind}>
        <span className="sr-only">{t(copy.title)}. {t(copy.description)}</span>
        <Skeleton active paragraph={{ rows: 5 }} title />
      </section>
    );
  }

  if (kind === "empty" || kind === "filtered-empty") {
    return (
      <section className="page-state" role="status" aria-live="polite" data-state={kind}>
        <Empty
          image={kind === "filtered-empty" ? <SearchOutlined className="page-state-icon" /> : Empty.PRESENTED_IMAGE_SIMPLE}
          description={<><strong>{t(copy.title)}</strong><span>{t(copy.description)}</span></>}
        />
      </section>
    );
  }

  const icon = kind === "forbidden" ? <LockOutlined /> : <WarningOutlined />;
  return (
    <section className="page-state" role="status" aria-live="polite" data-state={kind}>
      <Result icon={icon} title={t(copy.title)} subTitle={t(copy.description)} />
    </section>
  );
}

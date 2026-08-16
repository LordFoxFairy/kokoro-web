"use client";

import { StopOutlined } from "@ant-design/icons";
import { Alert, Button, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { commandErrorKey } from "@/components/feedback/command-error";
import { PageState } from "@/components/feedback/page-state";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import type { SessionCommandActionInput, SessionListItem, SessionListView } from "./schema";
import { sessionListHref } from "./url";

export type SessionAction = (input: SessionCommandActionInput) => Promise<CommandActionResult>;
type PendingSessionCommand =
  | Readonly<{ operation: "revoke"; session: SessionListItem; commandId: string }>
  | Readonly<{ operation: "revoke-all"; userId: string; commandId: string }>;

export function SessionTable({ view, action }: Readonly<{
  view: SessionListView;
  action: SessionAction;
}>): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState<PendingSessionCommand | null>(null);
  const [result, setResult] = useState<CommandActionResult | null>(null);

  async function confirm(reason: string): Promise<void> {
    if (pending === null) return;
    const identity = { requestId: crypto.randomUUID(), commandId: pending.commandId, reason };
    const response = pending.operation === "revoke"
      ? await action({
          operation: "revoke",
          sessionId: pending.session.id,
          userId: pending.session.userId,
          ...identity,
        })
      : await action({ operation: "revoke-all", userId: pending.userId, ...identity });
    setResult(response);
    if (response.status === "success") {
      setPending(null);
      router.refresh();
    }
  }

  const columns: ColumnsType<SessionListItem> = [
    { title: t("session.id"), dataIndex: "id", width: 300, className: "technical-value" },
    { title: t("session.userId"), dataIndex: "userId", width: 300, className: "technical-value" },
    { title: t("session.status"), dataIndex: "status", width: 110, render: (status: string) => <StatusTag status={status} /> },
    { title: t("session.organization"), dataIndex: "activeOrganizationId", width: 300, render: (value: string | null) => value ?? t("common.none") },
    { title: t("session.expiresAt"), dataIndex: "expiresAt", width: 190, render: (value: string) => <time dateTime={value}>{value}</time> },
    {
      title: t("session.actions"),
      key: "actions",
      width: 150,
      render: (_, session) => session.status === "active" ? (
        <Button
          aria-label={t("session.revoke")}
          danger
          icon={<StopOutlined />}
          size="small"
          type="text"
          onClick={() => {
            setResult(null);
            setPending({ operation: "revoke", session, commandId: crypto.randomUUID() });
          }}
        >
          {t("session.revoke")}
        </Button>
      ) : null,
    },
  ];

  return (
    <section className="session-section" aria-labelledby="sessions-title">
      <div className="section-heading">
        <div>
          <h2 id="sessions-title">{t("session.title")}</h2>
          <p>{t("session.description")}</p>
        </div>
        {view.filters.userId === null ? null : (
          <Button
            aria-label={t("session.revokeAll")}
            danger
            icon={<StopOutlined />}
            onClick={() => {
              setResult(null);
              setPending({ operation: "revoke-all", userId: view.filters.userId ?? "", commandId: crypto.randomUUID() });
            }}
          >
            {t("session.revokeAll")}
          </Button>
        )}
      </div>
      {pending === null && result?.status === "error" ? (
        <Alert
          className="command-result"
          type="error"
          showIcon
          title={`${t("action.error")} · ${t(commandErrorKey(result.kind))}`}
          description={result.requestId.length > 0 ? result.requestId : undefined}
        />
      ) : null}
      {pending === null && result?.status === "success" ? (
        <Alert
          className="command-result"
          type="success"
          showIcon
          title={t(result.replayed ? "action.replayed" : "action.success")}
        />
      ) : null}
      {view.items.length === 0 ? (
        <PageState kind="empty" />
      ) : (
        <div className="data-table" role="region" aria-label={t("session.title")} tabIndex={0}>
          <Table<SessionListItem> rowKey="id" columns={columns} dataSource={[...view.items]} pagination={false} scroll={{ x: 1180 }} />
        </div>
      )}
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(sessionListHref(view.filters, cursor))}
      />
      {pending === null ? null : (
        <CommandDialog
          open
          title={t(pending.operation === "revoke" ? "session.revokeTitle" : "session.revokeAllTitle")}
          entityLabel={pending.operation === "revoke" ? pending.session.id : pending.userId}
          danger
          result={result}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
}

"use client";

import { StopOutlined } from "@ant-design/icons";
import type { ProColumns } from "@ant-design/pro-table";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CommandDialog } from "@/components/command/command-dialog";
import { AdminTable } from "@/components/data/admin-table";
import { CursorPagination } from "@/components/data/cursor-pagination";
import { StatusTag } from "@/components/data/status-tag";
import { CommandResult } from "@/components/feedback/command-result";
import { PageState } from "@/components/feedback/page-state";
import { AdminPage } from "@/components/platform/admin-page";
import { AdminSection } from "@/components/platform/admin-section";
import { useT } from "@/i18n/context";
import type { CommandActionResult } from "@/lib/command-result";

import type { SessionCommandActionInput, SessionListItem, SessionListView } from "./schema";
import { sessionListHref } from "./url";

export type SessionAction = (input: SessionCommandActionInput) => Promise<CommandActionResult>;
type PendingSessionCommand =
  | Readonly<{ operation: "revoke"; session: SessionListItem; commandId: string }>
  | Readonly<{ operation: "revoke-all"; userId: string; commandId: string }>;

export function SessionTable({ view, action, embedded = false }: Readonly<{
  view: SessionListView;
  action: SessionAction;
  embedded?: boolean;
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

  const columns: ProColumns<SessionListItem>[] = [
    { title: t("session.id"), dataIndex: "id", width: 300, className: "technical-value" },
    { title: t("session.userId"), dataIndex: "userId", width: 300, className: "technical-value" },
    { title: t("session.status"), dataIndex: "status", width: 110, render: (_, session) => <StatusTag status={session.status} /> },
    { title: t("session.organization"), dataIndex: "activeOrganizationId", width: 300, render: (_, session) => session.activeOrganizationId ?? t("common.none") },
    { title: t("session.expiresAt"), dataIndex: "expiresAt", width: 190, render: (_, session) => <time dateTime={session.expiresAt}>{session.expiresAt}</time> },
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

  const revokeAll = view.filters.userId === null ? null : (
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
  );

  const body = (
    <>
      {pending === null ? <CommandResult result={result} /> : null}
      <AdminTable<SessionListItem>
        ariaLabel={t("session.title")}
        columns={columns}
        data={view.items}
        emptyText={<PageState kind="empty" />}
        rowKey="id"
        scrollX={1_180}
      />
      <CursorPagination
        canGoBack={view.filters.cursor !== null}
        nextCursor={view.nextCursor}
        onPrevious={() => router.back()}
        onNext={(cursor) => router.push(sessionListHref(view.filters, cursor))}
      />
    </>
  );

  const content = embedded ? (
    <AdminSection
      className="session-section"
      titleId="sessions-title"
      title={t("session.title")}
      description={t("session.description")}
      extra={revokeAll ?? undefined}
    >
      {body}
    </AdminSection>
  ) : (
    <AdminPage
      titleId="sessions-title"
      title={t("session.title")}
      description={t("session.description")}
      extra={revokeAll}
    >
      {body}
    </AdminPage>
  );

  return (
    <>
      {content}
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
    </>
  );
}

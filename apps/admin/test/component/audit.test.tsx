import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { AuditEventTable } from "../../modules/iam/audit/event-table";

const requestId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const commandId = "8deecb20-8d72-4b7e-a719-722a2e606728";

describe("IAM SecurityEvent ledger", () => {
  it("WEB-COMP-AUDIT-001 renders exact filters correlation safe metadata and pagination", () => {
    render(
      <LocaleProvider>
        <AuditEventTable view={{
          filters: {
            kind: "member.changed",
            actorUserId: "bce7762a-f7c7-4d22-8031-4336803038eb",
            targetUserId: "94944258-f6a2-4813-bd2e-3e4a38053021",
            organizationId: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
            commandId,
            createdAfter: "2026-08-16T12:00:00.000Z",
            createdBefore: "2026-08-16T13:00:00.000Z",
            cursor: "current/cursor",
            limit: 25,
          },
          items: [{
            id: "0dbc85ab-70fb-4362-8854-e4834be725ec",
            kind: "member.changed",
            actorUserId: "bce7762a-f7c7-4d22-8031-4336803038eb",
            targetUserId: "94944258-f6a2-4813-bd2e-3e4a38053021",
            organizationId: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
            sessionId: null,
            requestId,
            commandId,
            metadata: { roleKey: "owner" },
            createdAt: "2026-08-16T12:30:00.000Z",
          }],
          nextCursor: "next/cursor",
        }} />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { name: "安全审计" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "事件类型" })).toHaveValue("member.changed");
    expect(screen.getByRole("textbox", { name: "操作者用户 ID" })).toHaveValue("bce7762a-f7c7-4d22-8031-4336803038eb");
    expect(screen.getByText(requestId)).toBeInTheDocument();
    expect(screen.getAllByText(commandId).length).toBeGreaterThan(0);
    expect(screen.getByText("roleKey=owner")).toBeInTheDocument();
    expect(screen.queryByText(/operator-authored|TOKEN|PASSWORD/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });

  it("WEB-COMP-AUDIT-001 distinguishes a filtered empty result", () => {
    render(
      <LocaleProvider>
        <AuditEventTable view={{
          filters: {
            kind: "user.deleted",
            actorUserId: null,
            targetUserId: null,
            organizationId: null,
            commandId: null,
            createdAfter: null,
            createdBefore: null,
            cursor: null,
            limit: 25,
          },
          items: [],
          nextCursor: null,
        }} />
      </LocaleProvider>,
    );

    expect(screen.getByText("没有匹配结果")).toBeInTheDocument();
  });
});

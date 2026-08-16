import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionTable } from "../../modules/iam/sessions/session-table";
import { LocaleProvider } from "../../i18n/context";

const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const sessionId = "94944258-f6a2-4813-bd2e-3e4a38053021";

describe("IAM Session management", () => {
  it("WEB-COMP-SESSION-001 renders token-free sessions and confirms one revocation", async () => {
    const commands: unknown[] = [];
    const view = {
      items: [{
        id: sessionId,
        userId,
        status: "active" as const,
        activeOrganizationId: null,
        expiresAt: "2026-08-17T10:00:00.000Z",
        revokedAt: null,
        createdAt: "2026-08-16T10:00:00.000Z",
        updatedAt: "2026-08-16T10:00:00.000Z",
      }],
      nextCursor: null,
      filters: { userId, cursor: null, limit: 25 },
    };
    render(
      <LocaleProvider>
        <SessionTable
          view={view}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    expect(JSON.stringify(view)).not.toMatch(/session.?token|bearer/iu);
    expect(screen.getByText(sessionId)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销会话" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), {
      target: { value: "Device lost" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ operation: "revoke", sessionId, reason: "Device lost" });
  });

  it("WEB-COMP-SESSION-001 offers revoke-all only for a user-scoped inventory", () => {
    render(
      <LocaleProvider>
        <SessionTable
          view={{ items: [], nextCursor: null, filters: { userId, cursor: null, limit: 25 } }}
          action={async (input) => ({ status: "success", commandId: input.commandId, replayed: false })}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("button", { name: "撤销该用户全部会话" })).toBeInTheDocument();
  });
});

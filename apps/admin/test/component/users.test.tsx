import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserLifecycleControls, UserTable } from "../../modules/iam/users/user-table";
import { LocaleProvider } from "../../i18n/context";

const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";

describe("IAM User management", () => {
  it("WEB-COMP-USER-002 creates a standard User without password or administrator controls", async () => {
    const commands: unknown[] = [];
    render(
      <LocaleProvider>
        <UserTable
          view={{ items: [], nextCursor: null, filters: { query: "", status: "all", platformRole: "all", includeDeleted: false, cursor: null, limit: 25 } }}
          action={async (input) => { commands.push(input); return { status: "success", commandId: input.commandId, replayed: false }; }}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建用户" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/密码/u)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("平台角色")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "姓名" }), { target: { value: "New User" } });
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Provision account" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ operation: "create", email: "new@example.com", name: "New User", reason: "Provision account" });
    expect(commands[0]).not.toHaveProperty("password");
    expect(commands[0]).not.toHaveProperty("platformRole");
  });

  it("WEB-COMP-USER-001 renders authoritative filters and submits a versioned lifecycle command", async () => {
    const commands: unknown[] = [];
    const { container } = render(
      <LocaleProvider>
        <UserTable
          view={{
            items: [{
              id: userId,
              email: "admin@example.com",
              name: "Admin",
              platformRole: "admin",
              status: "active",
              version: "7",
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
              deletedAt: null,
            }],
            nextCursor: "next/cursor",
            filters: { query: "admin", status: "all", platformRole: "all", includeDeleted: false, cursor: null, limit: 25 },
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("admin");
    expect(
      container.querySelector(".ant-pro-query-filter .ant-btn-default")?.textContent?.replaceAll(" ", ""),
    ).toBe("重置");
    expect(container.querySelector(".ant-table-small")).not.toBeNull();
    expect(screen.getByRole("link", { name: "admin@example.com" })).toHaveAttribute("href", `/users/${userId}`);
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), {
      target: { value: "Security review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      operation: "suspend",
      userId,
      expectedVersion: "7",
      reason: "Security review",
    });
    expect(commands[0]).toMatchObject({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
  });

  it("WEB-COMP-USER-001 exposes restore only for deleted records", () => {
    render(
      <LocaleProvider>
        <UserLifecycleControls
          user={{
            id: userId,
            email: "deleted@example.com",
            name: "Deleted",
            platformRole: "user",
            status: "deleted",
            version: "8",
            createdAt: "2026-08-16T10:00:00.000Z",
            updatedAt: "2026-08-16T11:00:00.000Z",
            deletedAt: "2026-08-16T11:00:00.000Z",
          }}
          action={async (input) => ({ status: "success", commandId: input.commandId, replayed: false })}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("button", { name: "恢复" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用" })).not.toBeInTheDocument();
  });

  it("WEB-COMP-USER-001 presents safe action kinds as localized operator feedback", async () => {
    render(
      <LocaleProvider>
        <UserTable
          view={{
            items: [{
              id: userId,
              email: "admin@example.com",
              name: "Admin",
              platformRole: "admin",
              status: "active",
              version: "7",
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
              deletedAt: null,
            }],
            nextCursor: null,
            filters: { query: "", status: "all", platformRole: "all", includeDeleted: false, cursor: null, limit: 25 },
          }}
          action={async (input) => ({
            status: "error",
            commandId: input.commandId,
            kind: "in_progress",
            requestId: "8deecb20-8d72-4b7e-a719-722a2e606728",
          })}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Review" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(await screen.findByText(/命令仍在处理中/u)).toBeInTheDocument();
  });
});

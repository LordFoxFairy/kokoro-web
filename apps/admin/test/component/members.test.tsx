import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { MemberTable } from "../../modules/iam/members/member-table";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";

const roles = [
  { key: "owner", name: "Owner", description: "Full control", builtIn: true, permissionKeys: ["organization:delete"] },
  { key: "member", name: "Member", description: "Read access", builtIn: true, permissionKeys: ["organization:read"] },
] as const;

async function selectRole(label: string): Promise<void> {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "成员角色" }));
  const option = await waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")]
      .find((item) => item.textContent?.trim() === label);
    if (match === undefined) throw new Error(`Role option ${label} is not visible`);
    return match;
  });
  fireEvent.click(option);
}

describe("IAM Member management", () => {
  it("WEB-COMP-MEMBER-001 adds an active User with a provider-owned built-in role", async () => {
    const commands: unknown[] = [];
    render(
      <LocaleProvider>
        <MemberTable
          organizationId={organizationId}
          view={{
            items: [],
            nextCursor: null,
            filters: { includeDeleted: false, cursor: null, limit: 25 },
            roleOptions: roles,
            userOptions: [{ id: userId, email: "admin@example.com", name: "Admin" }],
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    fireEvent.change(screen.getByRole("combobox", { name: "用户" }), { target: { value: userId } });
    fireEvent.change(screen.getByRole("combobox", { name: "组织角色" }), { target: { value: "owner" } });
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Owner onboarding" } });
    fireEvent.click(screen.getByRole("button", { name: "确认添加" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      operation: "add",
      organizationId,
      userId,
      roleKey: "owner",
      reason: "Owner onboarding",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Full control")).toBeInTheDocument();
    expect(screen.getAllByText("内置角色").length).toBeGreaterThan(0);
  });

  it("WEB-COMP-MEMBER-001 changes role with expected version and supports the complete active lifecycle", async () => {
    const commands: unknown[] = [];
    render(
      <LocaleProvider>
        <MemberTable
          organizationId={organizationId}
          view={{
            items: [{
              id: memberId,
              organizationId,
              userId,
              userLabel: "admin@example.com",
              roleKey: "owner",
              status: "active",
              version: "4",
              deletedAt: null,
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
            }],
            nextCursor: null,
            filters: { includeDeleted: false, cursor: null, limit: 25 },
            roleOptions: roles,
            userOptions: [],
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    await selectRole("Member");
    fireEvent.click(screen.getByRole("button", { name: "变更角色" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Least privilege" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      operation: "change-role",
      organizationId,
      memberId,
      roleKey: "member",
      expectedVersion: "4",
      reason: "Least privilege",
    });
    expect(screen.getByRole("button", { name: "停用成员" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除成员" })).toBeInTheDocument();
  });

  it("WEB-COMP-MEMBER-001 displays IAM last-owner rejection and keeps authoritative controls", async () => {
    render(
      <LocaleProvider>
        <MemberTable
          organizationId={organizationId}
          view={{
            items: [{
              id: memberId,
              organizationId,
              userId,
              userLabel: "owner@example.com",
              roleKey: "owner",
              status: "active",
              version: "9",
              deletedAt: null,
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
            }],
            nextCursor: null,
            filters: { includeDeleted: false, cursor: null, limit: 25 },
            roleOptions: roles,
            userOptions: [],
          }}
          action={async (input) => ({
            status: "error",
            commandId: input.commandId,
            kind: "last_owner",
            requestId: "8deecb20-8d72-4b7e-a719-722a2e606728",
          })}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "移除成员" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Role cleanup" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(/操作会移除最后一位所有者/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除成员" })).toBeInTheDocument();
  });

  it("WEB-UNIT-COMMAND-001 freezes AddMember payload and rotates only requestId on recovery", async () => {
    const commands: Array<Record<string, unknown>> = [];
    render(
      <LocaleProvider>
        <MemberTable
          organizationId={organizationId}
          view={{
            items: [],
            nextCursor: null,
            filters: { includeDeleted: false, cursor: null, limit: 25 },
            roleOptions: roles,
            userOptions: [{ id: userId, email: "admin@example.com", name: "Admin" }],
          }}
          action={async (input) => {
            commands.push(input);
            return commands.length === 1
              ? { status: "error", commandId: input.commandId, kind: "in_progress", requestId: input.requestId }
              : { status: "success", commandId: input.commandId, replayed: true };
          }}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const user = screen.getByRole("combobox", { name: "用户" });
    const role = screen.getByRole("combobox", { name: "组织角色" });
    const reason = screen.getByRole("textbox", { name: "操作原因" });
    const confirm = screen.getByRole("button", { name: "确认添加" });
    fireEvent.change(user, { target: { value: userId } });
    fireEvent.change(role, { target: { value: "owner" } });
    fireEvent.change(reason, { target: { value: "Owner onboarding" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(1));

    expect(user).toBeDisabled();
    expect(role).toBeDisabled();
    expect(reason).toBeDisabled();
    fireEvent.change(role, { target: { value: "member" } });
    fireEvent.change(reason, { target: { value: "Changed digest" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(2));

    expect(commands[1]).toMatchObject({
      userId,
      roleKey: "owner",
      reason: "Owner onboarding",
      commandId: commands[0]?.commandId,
    });
    expect(commands[1]?.requestId).not.toBe(commands[0]?.requestId);
  });

  it("WEB-UNIT-COMMAND-001 freezes role change payload and identity on recovery", async () => {
    const commands: Array<Record<string, unknown>> = [];
    render(
      <LocaleProvider>
        <MemberTable
          organizationId={organizationId}
          view={{
            items: [{
              id: memberId,
              organizationId,
              userId,
              userLabel: "owner@example.com",
              roleKey: "owner",
              status: "active",
              version: "9",
              deletedAt: null,
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
            }],
            nextCursor: null,
            filters: { includeDeleted: false, cursor: null, limit: 25 },
            roleOptions: roles,
            userOptions: [],
          }}
          action={async (input) => {
            commands.push(input);
            return commands.length === 1
              ? { status: "error", commandId: input.commandId, kind: "in_progress", requestId: input.requestId }
              : { status: "success", commandId: input.commandId, replayed: true };
          }}
        />
      </LocaleProvider>,
    );

    await selectRole("Member");
    fireEvent.click(screen.getByRole("button", { name: "变更角色" }));
    const reason = screen.getByRole("textbox", { name: "操作原因" });
    const confirm = screen.getByRole("button", { name: "确认" });
    fireEvent.change(reason, { target: { value: "Least privilege" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(1));

    expect(reason).toBeDisabled();
    await selectRole("Owner");
    fireEvent.change(reason, { target: { value: "Changed digest" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(2));

    expect(commands[1]).toMatchObject({
      roleKey: "member",
      reason: "Least privilege",
      expectedVersion: "9",
      commandId: commands[0]?.commandId,
    });
    expect(commands[1]?.requestId).not.toBe(commands[0]?.requestId);
  });
});

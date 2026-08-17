import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { OrganizationDetail } from "../../modules/iam/organizations/organization-detail";
import { OrganizationTable } from "../../modules/iam/organizations/organization-table";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";

describe("IAM Organization management", () => {
  it("WEB-COMP-ORG-001 validates and submits Organization creation without inventing an identifier", async () => {
    const commands: unknown[] = [];
    render(
      <LocaleProvider>
        <OrganizationTable
          view={{
            items: [],
            nextCursor: null,
            filters: { query: "", status: "all", includeDeleted: false, cursor: null, limit: 25 },
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建组织" }));
    fireEvent.change(screen.getByRole("textbox", { name: "组织标识" }), { target: { value: "Invalid Slug" } });
    fireEvent.change(screen.getByRole("textbox", { name: "组织名称" }), { target: { value: "Kokoro Labs" } });
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Tenant onboarding" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    expect(commands).toHaveLength(0);
    expect(await screen.findByText("组织标识只能包含小写字母、数字和连字符")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "组织标识" }), { target: { value: "kokoro-labs" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      operation: "create",
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      reason: "Tenant onboarding",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(commands[0]).not.toHaveProperty("organizationId");
  });

  it("WEB-COMP-ORG-001 preserves URL filters and exposes authoritative lifecycle controls", async () => {
    const commands: unknown[] = [];
    render(
      <LocaleProvider>
        <OrganizationTable
          view={{
            items: [{
              id: organizationId,
              slug: "kokoro-labs",
              name: "Kokoro Labs",
              status: "active",
              version: "7",
              deletedAt: null,
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
            }],
            nextCursor: "next/cursor",
            filters: { query: "kokoro", status: "active", includeDeleted: false, cursor: null, limit: 25 },
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("searchbox", { name: "搜索组织" })).toHaveValue("kokoro");
    expect(screen.getByRole("link", { name: "Kokoro Labs" })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "删除组织" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Tenant closed" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      operation: "delete",
      organizationId,
      expectedVersion: "7",
      reason: "Tenant closed",
    });
  });

  it("WEB-COMP-ORG-001 exposes restore only for a deleted Organization", () => {
    render(
      <LocaleProvider>
        <OrganizationTable
          view={{
            items: [{
              id: organizationId,
              slug: "kokoro-labs",
              name: "Kokoro Labs",
              status: "deleted",
              version: "8",
              deletedAt: "2026-08-16T11:00:00.000Z",
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
            }],
            nextCursor: null,
            filters: { query: "", status: "deleted", includeDeleted: true, cursor: null, limit: 25 },
          }}
          action={async (input) => ({ status: "success", commandId: input.commandId, replayed: false })}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("button", { name: "恢复组织" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除组织" })).not.toBeInTheDocument();
  });

  it("WEB-UNIT-COMMAND-001 freezes CreateOrganization payload after the first RPC attempt", async () => {
    const commands: Array<Record<string, unknown>> = [];
    render(
      <LocaleProvider>
        <OrganizationTable
          view={{ items: [], nextCursor: null, filters: { query: "", status: "all", includeDeleted: false, cursor: null, limit: 25 } }}
          action={async (input) => {
            commands.push(input);
            return commands.length === 1
              ? { status: "error", commandId: input.commandId, kind: "in_progress", requestId: input.requestId }
              : { status: "success", commandId: input.commandId, replayed: true };
          }}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建组织" }));
    const slug = screen.getByRole("textbox", { name: "组织标识" });
    const name = screen.getByRole("textbox", { name: "组织名称" });
    const reason = screen.getByRole("textbox", { name: "操作原因" });
    const confirm = screen.getByRole("button", { name: "确认创建" });
    fireEvent.change(slug, { target: { value: "kokoro-labs" } });
    fireEvent.change(name, { target: { value: "Kokoro Labs" } });
    fireEvent.change(reason, { target: { value: "Tenant onboarding" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(1));

    expect(slug).toBeDisabled();
    expect(name).toBeDisabled();
    expect(reason).toBeDisabled();
    fireEvent.change(name, { target: { value: "Changed digest" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toMatchObject({
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      reason: "Tenant onboarding",
      commandId: commands[0]?.commandId,
    });
    expect(commands[1]?.requestId).not.toBe(commands[0]?.requestId);
  });

  it("WEB-COMP-ORG-001 keeps lifecycle errors visible inside the active dialog", async () => {
    render(
      <LocaleProvider>
        <OrganizationTable
          view={{
            items: [{
              id: organizationId,
              slug: "kokoro-labs",
              name: "Kokoro Labs",
              status: "deleted",
              version: "8",
              deletedAt: "2026-08-16T11:00:00.000Z",
              createdAt: "2026-08-16T10:00:00.000Z",
              updatedAt: "2026-08-16T11:00:00.000Z",
            }],
            nextCursor: null,
            filters: { query: "", status: "deleted", includeDeleted: true, cursor: null, limit: 25 },
          }}
          action={async (input) => ({
            status: "error",
            commandId: input.commandId,
            kind: "conflict",
            requestId: input.requestId,
            field: "slug",
          })}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复组织" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Restore tenant" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(await within(screen.getByRole("dialog")).findByText(/目标状态与当前操作冲突/u)).toBeInTheDocument();
  });

  it("WEB-UNIT-COMMAND-001 freezes UpdateOrganization payload on recovery", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const organization = {
      id: organizationId,
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      status: "active" as const,
      version: "7",
      deletedAt: null,
      createdAt: "2026-08-16T10:00:00.000Z",
      updatedAt: "2026-08-16T11:00:00.000Z",
    };
    render(
      <LocaleProvider>
        <OrganizationDetail
          view={{
            organization,
            members: { items: [], nextCursor: null, filters: { includeDeleted: false, cursor: null, limit: 25 }, roleOptions: [], userOptions: [] },
            roles: { items: [], permissionGroups: [] },
            events: [],
          }}
          organizationAction={async (input) => {
            commands.push(input);
            return commands.length === 1
              ? { status: "error", commandId: input.commandId, kind: "in_progress", requestId: input.requestId }
              : { status: "success", commandId: input.commandId, replayed: true };
          }}
          memberAction={async (input) => ({ status: "success", commandId: input.commandId, replayed: false })}
          roleAction={async (input) => ({ status: "success", commandId: input.commandId, replayed: false })}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /更新组织/u }));
    const name = screen.getByRole("textbox", { name: "组织名称" });
    const reason = screen.getByRole("textbox", { name: "操作原因" });
    const confirm = screen.getByRole("button", { name: "确认更新" });
    fireEvent.change(name, { target: { value: "Kokoro Platform" } });
    fireEvent.change(reason, { target: { value: "Rename review" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(1));

    expect(name).toBeDisabled();
    expect(reason).toBeDisabled();
    fireEvent.change(name, { target: { value: "Changed digest" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toMatchObject({
      name: "Kokoro Platform",
      reason: "Rename review",
      commandId: commands[0]?.commandId,
    });
    expect(commands[1]?.requestId).not.toBe(commands[0]?.requestId);
  });
});

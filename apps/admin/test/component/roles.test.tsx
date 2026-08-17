import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { OrganizationRoleManagement } from "../../modules/iam/roles/role-management";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const customRoleId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";

describe("Organization Role management", () => {
  it("WEB-COMP-ROLE-001 hides built-in mutations and replaces a custom Role permission set", async () => {
    const commands: unknown[] = [];
    render(
      <LocaleProvider>
        <OrganizationRoleManagement
          organizationId={organizationId}
          view={{
            items: [
              { id: "4f7556a0-64ea-4da0-8996-d1f744035b75", organizationId, key: "owner", name: "Owner", description: "Full control", builtIn: true, status: "active", version: "1", permissionKeys: ["organization:read"] },
              { id: customRoleId, organizationId, key: "auditor", name: "Auditor", description: "Review access", builtIn: false, status: "active", version: "3", permissionKeys: ["organization:read"] },
            ],
            permissionGroups: [
              { resource: "member", permissions: [{ key: "member:read", action: "read", description: "Read members" }] },
              { resource: "organization", permissions: [
                { key: "organization:read", action: "read", description: "Read organization" },
                { key: "organization:update", action: "update", description: "Update organization" },
              ] },
            ],
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    const ownerRow = screen.getByRole("row", { name: /Owner/u });
    expect(within(ownerRow).queryByRole("button", { name: /编辑角色/u })).not.toBeInTheDocument();
    const auditorRow = screen.getByRole("row", { name: /Auditor/u });
    fireEvent.click(within(auditorRow).getByRole("button", { name: /配置权限/u }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("member")).toBeInTheDocument();
    expect(within(dialog).getByText("organization")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /organization:update/u }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "操作原因" }), { target: { value: "Expand auditor access" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存权限" }));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      operation: "set-permissions", organizationId, roleId: customRoleId, expectedVersion: "3",
      permissionKeys: ["organization:read", "organization:update"], reason: "Expand auditor access",
    });
  });
});

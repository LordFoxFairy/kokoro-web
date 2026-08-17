import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { AccessCatalog } from "../../modules/iam/access/access-catalog";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";

describe("IAM live Access inspection", () => {
  it("WEB-COMP-ACCESS-001 renders provider Role and Permission catalogs with a live allow result", () => {
    render(
      <LocaleProvider>
        <AccessCatalog
          view={{
            organizations: [{ id: organizationId, slug: "kokoro-labs", name: "Kokoro Labs" }],
            nextOrganizationCursor: "next/cursor",
            users: [{ id: "bce7762a-f7c7-4d22-8031-4336803038eb", email: "member@example.com", name: "Member" }],
            roles: [{
              key: "owner",
              name: "Owner",
              description: "Full control",
              builtIn: true,
              status: "active",
              permissionKeys: ["organization:delete"],
            }],
            permissions: [{
              key: "organization:delete",
              resource: "organization",
              action: "delete",
              description: "Soft delete an organization.",
              status: "active",
            }],
            filters: {
              organizationId,
              organizationQuery: "kokoro",
              organizationCursor: "current/cursor",
              organizationLimit: 25,
              userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
              userQuery: "member",
              permissionKey: "organization:delete",
              resourceRef: null,
            },
            decision: {
              allowed: true,
              reasonCode: "allowed",
              userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
              organizationId,
              roleKeys: ["owner"],
              authorizationVersion: "12",
              evaluatedAt: "2026-08-16T12:00:00.000Z",
            },
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { name: "访问控制" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "检查用户授权", selected: true })).toBeInTheDocument();
    expect(screen.getByText("允许")).toBeInTheDocument();
    expect(screen.getByText("allowed")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索组织" })).toHaveValue("kokoro");
    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("member");
    expect(screen.getByRole("combobox", { name: "组织" })).toHaveAttribute("aria-valuetext", organizationId);
    expect(screen.getByRole("combobox", { name: "用户" })).toHaveAttribute(
      "aria-valuetext",
      "bce7762a-f7c7-4d22-8031-4336803038eb",
    );
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();

    fireEvent.click(screen.getByRole("tab", { name: "角色目录" }));
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Full control")).toBeInTheDocument();
    expect(screen.getAllByText("内置角色").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "权限目录" }));
    expect(screen.getByText("Soft delete an organization.")).toBeInTheDocument();
    const permissionTree = within(screen.getByRole("tree", { name: "权限树" }));
    expect(permissionTree.getByRole("treeitem", { name: /organization/u })).toBeInTheDocument();
    expect(permissionTree.getByText("delete")).toBeInTheDocument();
    expect(permissionTree.getByText("已授权")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "描述" })).toBeInTheDocument();
    expect(screen.queryByText("会话 ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /创建|删除|修改/u })).not.toBeInTheDocument();
  });

  it("WEB-COMP-ACCESS-001 renders a provider deny result without client reinterpretation", () => {
    render(
      <LocaleProvider>
        <AccessCatalog
          view={{
            organizations: [{ id: organizationId, slug: "kokoro-labs", name: "Kokoro Labs" }],
            nextOrganizationCursor: null,
            users: [{ id: "bce7762a-f7c7-4d22-8031-4336803038eb", email: "member@example.com", name: "Member" }],
            roles: [],
            permissions: [{
              key: "organization:delete",
              resource: "organization",
              action: "delete",
              description: "Soft delete an organization.",
              status: "active",
            }],
            filters: {
              organizationId,
              organizationQuery: "",
              organizationCursor: null,
              organizationLimit: 25,
              userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
              userQuery: "",
              permissionKey: "organization:delete",
              resourceRef: null,
            },
            decision: {
              allowed: false,
              reasonCode: "membership_inactive",
              userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
              organizationId,
              roleKeys: [],
              authorizationVersion: "13",
              evaluatedAt: "2026-08-16T12:01:00.000Z",
            },
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("拒绝")).toBeInTheDocument();
    expect(screen.getByText("membership_inactive")).toBeInTheDocument();
  });
});

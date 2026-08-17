import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/context";
import { SiteDetail } from "../../modules/iam/sites/site-detail";
import { SiteAccess } from "../../modules/iam/sites/site-access";
import { SiteAudit } from "../../modules/iam/sites/site-audit";
import { SiteMembers } from "../../modules/iam/sites/site-members";
import { SiteTable } from "../../modules/iam/sites/site-table";

const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const site = {
  id: siteId, code: "kokoro-labs", name: "Kokoro Labs", status: "active" as const, version: "7",
  deletedAt: null, createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T11:00:00.000Z",
};
const filters = { tab: "overview" as const, memberQuery: "", includeDeletedMembers: false, memberCursor: null, memberLimit: 25, permissionKey: "site:read", authorizationUserId: userId, resourceRef: null, auditKind: null, auditActorUserId: null, auditTargetUserId: null, auditCursor: null, auditLimit: 25 } as const;
const members = {
  items: [{ id: memberId, siteId, userId, userLabel: "admin@example.com", roleKey: "owner" as const, status: "active" as const, version: "3", deletedAt: null, createdAt: site.createdAt, updatedAt: site.updatedAt }],
  nextCursor: null,
  filters: { memberQuery: "", includeDeletedMembers: false, memberCursor: null, memberLimit: 25 },
  roleOptions: [{ key: "owner" as const, label: "Owner" }, { key: "admin" as const, label: "Admin" }],
  userOptions: [{ id: userId, email: "admin@example.com", name: "Admin" }],
};
const audit = { items: [{ id: "3598c32a-c62b-4803-92c2-b5baaf507d9f", kind: "site.created", actorUserId: userId, targetUserId: null, siteId, requestId: "8deecb20-8d72-4b7e-a719-722a2e606728", commandId: "df486566-7614-461f-a72c-1b3d4ea9e985", createdAt: site.createdAt }], nextCursor: null, statistics: { total: "1", byKind: [{ kind: "site.created", count: "1" }] } };
const roles = { items: [], permissionGroups: [] };

describe("IAM Site management", () => {
  it("WEB-COMP-SITE-001 submits Site creation and authoritative lifecycle commands", async () => {
    const commands: Array<Record<string, unknown>> = [];
    render(
      <LocaleProvider>
        <SiteTable
          view={{ items: [site], nextCursor: null, filters: { query: "kokoro", status: "active", includeDeleted: false, cursor: null, limit: 25 } }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("searchbox", { name: "搜索 Site" })).toHaveValue("kokoro");
    expect(screen.getByRole("link", { name: "Kokoro Labs" })).toHaveAttribute("href", `/sites/${siteId}`);
    fireEvent.click(screen.getByRole("button", { name: "创建 Site" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Site 标识" }), { target: { value: "new-site" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Site 名称" }), { target: { value: "New Site" } });
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Workspace onboarding" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ operation: "create", code: "new-site", name: "New Site" });

    fireEvent.click(screen.getByRole("button", { name: "暂停 Site" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Security review" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toMatchObject({ operation: "suspend", siteId, expectedVersion: "7" });
  });

  it("WEB-COMP-SITE-002 keeps a stable four-tab detail and executes member, access and audit workflows", async () => {
    const commands: Array<Record<string, unknown>> = [];
    render(
      <LocaleProvider>
        <SiteDetail
          view={{
            site,
            filters,
            members,
            roles,
            permissionKeys: ["site:read", "site_member:update"],
            authorization: { allowed: true, reasonCode: "role_grant", userId, siteId, roleKeys: ["owner"], authorizationVersion: "9", evaluatedAt: site.updatedAt },
            audit,
          }}
          action={async (input) => {
            commands.push(input);
            return { status: "success", commandId: input.commandId, replayed: false };
          }}
          roleAction={async (input) => ({ status: "success", commandId: input.commandId, replayed: false })}
        />
      </LocaleProvider>,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    expect(commands).toHaveLength(0);
  });

  it("WEB-COMP-SITE-003 executes a scoped Site member lifecycle command", async () => {
    const commands: Array<Record<string, unknown>> = [];
    render(<LocaleProvider><SiteMembers siteId={siteId} view={members} filters={filters} action={async (input) => { commands.push(input); return { status: "success", commandId: input.commandId, replayed: false }; }} /></LocaleProvider>);
    fireEvent.click(screen.getByRole("button", { name: "停用成员" }));
    fireEvent.change(screen.getByRole("textbox", { name: "操作原因" }), { target: { value: "Membership review" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ operation: "suspend-member", siteId, memberId, expectedVersion: "3" });
  });

  it("WEB-COMP-SITE-004 renders a Site-correlated authorization decision and permission catalog", () => {
    render(<LocaleProvider><SiteAccess siteId={siteId} permissionKeys={["site:read", "site_member:update"]} members={members} filters={filters} authorization={{ allowed: true, reasonCode: "role_grant", userId, siteId, roleKeys: ["owner"], authorizationVersion: "9", evaluatedAt: site.updatedAt }} /></LocaleProvider>);
    expect(screen.getByText("允许")).toBeInTheDocument();
    expect(screen.getAllByText("site:read").length).toBeGreaterThan(0);
    expect(screen.getByText("role_grant")).toBeInTheDocument();
  });

  it("WEB-COMP-SITE-005 renders only scoped Site audit evidence and full-filter statistics", () => {
    render(<LocaleProvider><SiteAudit siteId={siteId} audit={audit} filters={filters} /></LocaleProvider>);
    expect(screen.getAllByText("site.created").length).toBeGreaterThan(0);
    expect(screen.getByText("1", { selector: ".site-audit-total .ant-statistic-content-value-int" })).toBeInTheDocument();
    expect(screen.queryByText("another-site")).not.toBeInTheDocument();
  });
});

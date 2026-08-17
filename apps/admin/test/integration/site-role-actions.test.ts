import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import { SiteRoleRecordSchema, type CommandContext } from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createSiteRoleActionHandler } from "../../modules/iam/sites/role-actions";
import type { SiteRoleCommandActionInput } from "../../modules/iam/sites/schema";
import { createIamManagementClient } from "../../server/iam/management-client";

const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const foreignSiteId = "21ec9d0b-429e-473b-b41b-8b52a91ca5d3";
const roleId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const builtInRoleId = "4f7556a0-64ea-4da0-8996-d1f744035b75";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";

describe("Site custom roles", () => {
  it("WEB-INT-SITEROLE-001 executes custom CRUD and complete permission replacement", async () => {
    const calls: Array<Readonly<{ operation: string; expectedVersion?: bigint; permissions?: readonly string[] }>> = [];
    const transport = createRouterTransport((router) => router.service(IamSiteService, {
      listSiteRoles: () => ({ roles: [siteRole(roleId, "reviewer", false)] }),
      createSiteRole: (request) => mutation("create", request.command, request.permissionKeys),
      updateSiteRole: (request) => mutation("update", request.command),
      setSiteRolePermissions: (request) => mutation("set-permissions", request.command, request.permissionKeys),
      deleteSiteRole: (request) => mutation("delete", request.command, undefined, "deleted"),
      restoreSiteRole: (request) => mutation("restore", request.command),
    }));
    const revalidated: string[] = [];
    const handle = createSiteRoleActionHandler({ loadClient: async () => createIamManagementClient(transport), revalidatePath: (path) => revalidated.push(path) });
    const commands: SiteRoleCommandActionInput[] = [
      { operation: "create", siteId, key: "reviewer", name: "Reviewer", description: "Reviews Site content", permissionKeys: ["site:read", "site_role:read"], ...identity(1) },
      { operation: "update", siteId, roleId, name: "Senior Reviewer", description: "Senior review", expectedVersion: "2", ...identity(2) },
      { operation: "set-permissions", siteId, roleId, permissionKeys: ["site_role:update", "site:read"], expectedVersion: "3", ...identity(3) },
      { operation: "delete", siteId, roleId, expectedVersion: "4", ...identity(4) },
      { operation: "restore", siteId, roleId, expectedVersion: "5", ...identity(5) },
    ];
    for (const input of commands) expect(await handle(input), input.operation).toMatchObject({ status: "success" });
    expect(calls).toEqual([
      { operation: "create", expectedVersion: undefined, permissions: ["site:read", "site_role:read"] },
      { operation: "update", expectedVersion: BigInt(2) },
      { operation: "set-permissions", expectedVersion: BigInt(3), permissions: ["site:read", "site_role:update"] },
      { operation: "delete", expectedVersion: BigInt(4) },
      { operation: "restore", expectedVersion: BigInt(5) },
    ]);
    expect(revalidated).toEqual(Array.from({ length: 5 }, () => `/sites/${siteId}`));

    function mutation(operation: string, command: CommandContext | undefined, permissions?: readonly string[], status: "active" | "deleted" = "active") {
      if (command === undefined) throw new Error("command required");
      calls.push({ operation, expectedVersion: command.expectedVersion, ...(permissions === undefined ? {} : { permissions }) });
      return { role: siteRole(roleId, "reviewer", false, status, permissions), replayed: false };
    }
  });

  it("WEB-SEC-SITEROLE-001 rejects reserved keys, built-in mutation and foreign scope", async () => {
    let mutationCalls = 0;
    let foreign = false;
    const transport = createRouterTransport((router) => router.service(IamSiteService, {
      listSiteRoles: () => ({ roles: [siteRole(builtInRoleId, "owner", true, "active", undefined, foreign ? foreignSiteId : siteId)] }),
      updateSiteRole: () => { mutationCalls += 1; return { role: siteRole(builtInRoleId, "owner", true) }; },
    }));
    const handle = createSiteRoleActionHandler({ loadClient: async () => createIamManagementClient(transport), revalidatePath: () => undefined });
    expect(await handle({ operation: "create", siteId, key: "owner", name: "Owner", description: "Reserved", permissionKeys: [], ...identity(6) } as never)).toMatchObject({ status: "error", kind: "invalid" });
    expect(await handle({ operation: "update", siteId, roleId: builtInRoleId, name: "Changed", description: "Forbidden", expectedVersion: "1", ...identity(7) })).toMatchObject({ status: "error", kind: "forbidden" });
    expect(mutationCalls).toBe(0);
    foreign = true;
    expect(await handle({ operation: "delete", siteId, roleId: builtInRoleId, expectedVersion: "1", ...identity(8) })).toMatchObject({ status: "error", kind: "internal" });
  });
});

function identity(index: number) {
  return { requestId, commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, reason: "Site role governance" };
}

function siteRole(id: string, key: string, builtIn: boolean, status: "active" | "deleted" = "active", permissions: readonly string[] = ["site:read"], targetSiteId = siteId) {
  return create(SiteRoleRecordSchema, { id, siteId: targetSiteId, key, name: key, description: `${key} role`, builtIn, status, version: BigInt(1), permissionKeys: [...permissions] });
}

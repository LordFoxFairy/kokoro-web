import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { IamAuthAdapterService } from "../../generated/iam/proto/kokoro/iam/v1/auth_adapter_pb";
import { IamAuthorizationService } from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import { IamCredentialService } from "../../generated/iam/proto/kokoro/iam/v1/credential_pb";
import { IamDevelopmentFixtureService } from "../../generated/iam/proto/kokoro/iam/v1/development_fixture_pb";
import {
  ChangeMemberRoleRequestSchema,
  IamOrganizationService,
  ReactivateMemberRequestSchema,
  RemoveMemberRequestSchema,
  RestoreMemberRequestSchema,
  SuspendMemberRequestSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import {
  IamSessionService,
  ListSessionsResponseSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import { IamSiteService } from "../../generated/iam/proto/kokoro/iam/v1/site_pb";
import { SessionSummaryRecordSchema } from "../../generated/iam/proto/kokoro/iam/v1/types_pb";

const appRoot = resolve(import.meta.dirname, "../..");
const generatedRoot = resolve(appRoot, "generated/iam/proto");

function methodNames(service: { readonly methods: readonly { readonly name: string }[] }): string[] {
  return service.methods.map((method) => method.name).sort();
}

describe("generated IAM service inventory", () => {
  it("WEB-CONTRACT-RPC-001 exposes all fourteen Auth.js Adapter methods", () => {
    expect(methodNames(IamAuthAdapterService)).toEqual([
      "CreateSession",
      "CreateUser",
      "CreateVerificationToken",
      "DeleteSession",
      "DeleteUser",
      "GetSessionAndUser",
      "GetUser",
      "GetUserByAccount",
      "GetUserByEmail",
      "LinkAccount",
      "UnlinkAccount",
      "UpdateSession",
      "UpdateUser",
      "UseVerificationToken",
    ].sort());
  });

  it("WEB-CONTRACT-RPC-001 exposes every accepted administration method", () => {
    expect(methodNames(IamAdministrationService)).toEqual([
      "CreateUser",
      "DeleteUser",
      "GetOrganization",
      "GetUser",
      "ListOrganizations",
      "ListSecurityEvents",
      "ListUsers",
      "ReactivateUser",
      "RestoreUser",
      "RevokeUserSessions",
      "SuspendUser",
      "UpdateUser",
    ].sort());
  });

  it("WEB-CONTRACT-RPC-001 exposes every accepted organization method", () => {
    expect(methodNames(IamOrganizationService)).toEqual([
      "AddMember",
      "ChangeMemberRole",
      "CreateOrganization",
      "CreateOrganizationRole",
      "DeleteOrganization",
      "DeleteOrganizationRole",
      "GetOrganization",
      "ListMembers",
      "ListOrganizations",
      "ListOrganizationRoles",
      "ReactivateMember",
      "RemoveMember",
      "RestoreMember",
      "RestoreOrganization",
      "RestoreOrganizationRole",
      "SetOrganizationRolePermissions",
      "SuspendMember",
      "UpdateOrganization",
      "UpdateOrganizationRole",
    ].sort());
  });

  it("WEB-CONTRACT-RPC-001 exposes every accepted authorization and Session method", () => {
    expect(methodNames(IamAuthorizationService)).toEqual([
      "Authorize",
      "AuthorizeSite",
      "InspectUserAuthorization",
      "InspectUserSiteAuthorization",
      "ListPermissionCatalog",
      "ListRoleCatalog",
    ].sort());
    expect(methodNames(IamSessionService)).toEqual([
      "IssueAccessToken",
      "ListSessions",
      "RevokeAllSessions",
      "RevokeSession",
    ].sort());
    expect(methodNames(IamCredentialService)).toEqual(["LoginAdministrator"]);
    expect(methodNames(IamSiteService)).toEqual([
      "AddSiteMember",
      "ChangeSiteMemberRole",
      "CreateSite",
      "CreateSiteRole",
      "DeleteSite",
      "DeleteSiteRole",
      "GetSite",
      "ListSiteMembers",
      "ListSites",
      "ListSiteRoles",
      "ReactivateSite",
      "ReactivateSiteMember",
      "RemoveSiteMember",
      "RestoreSite",
      "RestoreSiteMember",
      "RestoreSiteRole",
      "SelectSite",
      "SetSiteRolePermissions",
      "SuspendSite",
      "SuspendSiteMember",
      "UpdateSite",
      "UpdateSiteRole",
    ].sort());
  });

  it("WEB-CONTRACT-DEVFIXTURE-001 exposes only administrator bootstrap and password reset", () => {
    expect(methodNames(IamDevelopmentFixtureService)).toEqual([
      "BootstrapDevelopmentAdministrator",
      "ResetDevelopmentAdministratorPassword",
    ]);
  });

  it("WEB-CONTRACT-RPC-001 binds every non-add Member mutation to the exact Organization field", () => {
    expect(requestFields(ChangeMemberRoleRequestSchema)).toEqual([
      ["command", 1],
      ["member_id", 2],
      ["role_key", 3],
      ["organization_id", 4],
    ]);
    for (const schema of [
      SuspendMemberRequestSchema,
      ReactivateMemberRequestSchema,
      RemoveMemberRequestSchema,
      RestoreMemberRequestSchema,
    ]) {
      expect(requestFields(schema), schema.typeName).toEqual([
        ["command", 1],
        ["member_id", 2],
        ["organization_id", 3],
      ]);
    }
  });

  it("WEB-CONTRACT-RPC-001 keeps administrative Session records token-free", () => {
    const summary = create(SessionSummaryRecordSchema);
    const response = create(ListSessionsResponseSchema, { sessions: [summary] });

    expect(summary).not.toHaveProperty("sessionToken");
    expect(response.sessions[0]?.$typeName).toBe("kokoro.iam.v1.SessionSummaryRecord");
  });

  it("WEB-CONTRACT-PROTO-001 contains only generated portable TypeScript", async () => {
    const sources = (await filesBelow(generatedRoot)).filter((path) => path.endsWith("_pb.ts"));

    expect(sources).toHaveLength(11);
    for (const path of sources) {
      const source = await readFile(path, "utf8");
      expect(source, path).toContain("// @generated by protoc-gen-es v2.14.0");
      expect(source, path).not.toContain("/Users/");
      expect(source, path).not.toContain("kokoro-iam/");
      expect(source, path).not.toMatch(/from ["'][.]{1,2}\/[^"']+\.js["']/u);
    }
  });
});

function requestFields(schema: { readonly fields: readonly { readonly name: string; readonly number: number }[] }) {
  return schema.fields.map((field) => [field.name, field.number]);
}

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const pathname = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(pathname));
    else files.push(pathname);
  }
  return files.sort();
}

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  OrganizationRecordSchema,
  PermissionRecordSchema,
  RoleRecordSchema,
  SiteMemberRecordSchema,
  SiteRecordSchema,
  SiteRoleRecordSchema,
  UserRecordSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import {
  AuthorizeSiteResponseSchema,
  AuthorizeResponseSchema,
  InspectUserSiteAuthorizationResponseSchema,
  InspectUserAuthorizationResponseSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import {
  siteAuthorizationFromResponse,
  siteAuthorizationInspectionFromResponse,
  siteFromRecord,
  siteMemberFromRecord,
  siteRoleFromRecord,
  authorizationFromResponse,
  authorizationInspectionFromResponse,
  organizationFromRecord,
  permissionFromRecord,
  roleFromRecord,
  userFromRecord,
} from "../../server/iam/records";

const createdAt = new Date("2026-08-15T20:00:00.000Z");
const updatedAt = new Date("2026-08-15T20:05:00.000Z");

describe("strict IAM domain record mapping", () => {
  it("WEB-UNIT-RECORD-001 maps a complete UserRecord to an immutable AdminUser", () => {
    const user = userFromRecord(create(UserRecordSchema, {
      id: "bce7762a-f7c7-4d22-8031-4336803038eb",
      email: "admin@example.com",
      name: "Admin",
      platformRole: "admin",
      status: "active",
      version: BigInt(7),
      createdAt: timestampFromDate(createdAt),
      updatedAt: timestampFromDate(updatedAt),
    }));

    expect(user).toEqual({
      id: "bce7762a-f7c7-4d22-8031-4336803038eb",
      email: "admin@example.com",
      name: "Admin",
      image: null,
      emailVerified: null,
      platformRole: "admin",
      status: "active",
      version: BigInt(7),
      deletedAt: null,
      createdAt,
      updatedAt,
    });
    expect(Object.isFrozen(user)).toBe(true);
  });

  it("WEB-UNIT-RECORD-001 maps a complete OrganizationRecord", () => {
    const organization = organizationFromRecord(create(OrganizationRecordSchema, {
      id: "94944258-f6a2-4813-bd2e-3e4a38053021",
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      status: "active",
      version: BigInt(3),
      createdAt: timestampFromDate(createdAt),
      updatedAt: timestampFromDate(updatedAt),
    }));

    expect(organization).toEqual({
      id: "94944258-f6a2-4813-bd2e-3e4a38053021",
      slug: "kokoro-labs",
      name: "Kokoro Labs",
      status: "active",
      version: BigInt(3),
      deletedAt: null,
      createdAt,
      updatedAt,
    });
    expect(Object.isFrozen(organization)).toBe(true);
  });

  it("WEB-UNIT-SITE-001 maps immutable Site and SiteMember records", () => {
    const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
    const site = siteFromRecord(create(SiteRecordSchema, {
      id: siteId,
      code: "kokoro-main",
      name: "Kokoro Main",
      status: "active",
      version: BigInt(3),
      createdAt: timestampFromDate(createdAt),
      updatedAt: timestampFromDate(updatedAt),
    }));
    const member = siteMemberFromRecord(create(SiteMemberRecordSchema, {
      id: "b9d876d1-f22a-4cd6-9723-cfbd344ebccb",
      siteId,
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      roleId: "4f7556a0-64ea-4da0-8996-d1f744035b75",
      roleKey: "owner",
      status: "active",
      version: BigInt(2),
      createdAt: timestampFromDate(createdAt),
      updatedAt: timestampFromDate(updatedAt),
    }));

    expect(site).toMatchObject({ id: siteId, code: "kokoro-main", status: "active", version: BigInt(3) });
    expect(member).toMatchObject({ siteId, roleKey: "owner", status: "active", version: BigInt(2) });
    expect(Object.isFrozen(site)).toBe(true);
    expect(Object.isFrozen(member)).toBe(true);
  });

  it("WEB-UNIT-RBAC-001 accepts custom role keys and enforces Organization and Site scope", () => {
    const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
    const siteId = "b9d876d1-f22a-4cd6-9723-cfbd344ebccb";
    const organizationRole = roleFromRecord(create(RoleRecordSchema, {
      id: "4f7556a0-64ea-4da0-8996-d1f744035b75",
      organizationId,
      key: "billing_reviewer",
      name: "Billing reviewer",
      description: "Reviews invoices.",
      status: "active",
      version: BigInt(1),
      permissionKeys: ["billing:read"],
    }), organizationId);
    const siteRole = siteRoleFromRecord(create(SiteRoleRecordSchema, {
      id: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
      siteId,
      key: "content_editor",
      name: "Content editor",
      description: "Edits Site content.",
      status: "active",
      version: BigInt(2),
      permissionKeys: ["site:update"],
    }), siteId);

    expect(organizationRole.key).toBe("billing_reviewer");
    expect(siteRole).toMatchObject({ siteId, key: "content_editor" });
    expect(() => roleFromRecord(create(RoleRecordSchema, {
      ...organizationRole,
      permissionKeys: [...organizationRole.permissionKeys],
    }), siteId))
      .toThrow("invalid organization role scope");
    expect(() => siteRoleFromRecord(create(SiteRoleRecordSchema, {
      ...siteRole,
      siteId,
      permissionKeys: [...siteRole.permissionKeys],
    }), organizationId)).toThrow("invalid site role scope");
  });

  it("WEB-UNIT-SITE-001 preserves Site scope in live and inspected authorization", () => {
    const siteId = "94944258-f6a2-4813-bd2e-3e4a38053021";
    const common = {
      allowed: true,
      reasonCode: "allowed",
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      siteId,
      roleKeys: ["owner"],
      authorizationVersion: BigInt(5),
      evaluatedAt: timestampFromDate(updatedAt),
    };
    const decision = siteAuthorizationFromResponse(create(AuthorizeSiteResponseSchema, {
      ...common,
      sessionId: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
    }));
    const inspection = siteAuthorizationInspectionFromResponse(
      create(InspectUserSiteAuthorizationResponseSchema, common),
    );

    expect(decision).toMatchObject({ siteId, sessionId: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8" });
    expect(inspection).toMatchObject({ siteId });
    expect(inspection).not.toHaveProperty("sessionId");
  });

  it("WEB-UNIT-SITE-001 rejects malformed Site scope records", () => {
    expect(() => siteFromRecord(create(SiteRecordSchema, {
      id: "94944258-f6a2-4813-bd2e-3e4a38053021",
      code: "INVALID CODE",
      name: "Kokoro Main",
      status: "active",
      version: BigInt(1),
      createdAt: timestampFromDate(createdAt),
      updatedAt: timestampFromDate(updatedAt),
    }))).toThrow("invalid IAM SiteRecord");
  });

  it("WEB-UNIT-RECORD-001 rejects missing records timestamps and unknown enums", () => {
    expect(() => userFromRecord(undefined)).toThrow("invalid IAM UserRecord");
    expect(() => organizationFromRecord(undefined)).toThrow("invalid IAM OrganizationRecord");
    expect(() => userFromRecord(create(UserRecordSchema, {
      id: "bce7762a-f7c7-4d22-8031-4336803038eb",
      email: "admin@example.com",
      name: "Admin",
      platformRole: "root",
      status: "active",
      version: BigInt(1),
    }))).toThrow("invalid IAM UserRecord");
  });

  it("WEB-UNIT-RECORD-001 accepts the provider-owned retired Permission status", () => {
    const permission = permissionFromRecord(create(PermissionRecordSchema, {
      id: "21ec9d0b-429e-473b-b41b-8b52a91ca5d3",
      key: "organization:delete",
      resource: "organization",
      action: "delete",
      description: "Soft delete an organization.",
      status: "retired",
    }));

    expect(permission).toMatchObject({ key: "organization:delete", status: "retired" });
  });

  it("WEB-UNIT-RECORD-001 rejects an authorization reason outside the accepted provider catalog", () => {
    expect(() => authorizationFromResponse(create(AuthorizeResponseSchema, {
      allowed: false,
      reasonCode: "unexpected_reason",
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      sessionId: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
      organizationId: "94944258-f6a2-4813-bd2e-3e4a38053021",
      roleKeys: ["member"],
      authorizationVersion: BigInt(4),
      evaluatedAt: timestampFromDate(updatedAt),
    }))).toThrow("invalid IAM AuthorizeResponse");
  });

  it("WEB-UNIT-RECORD-001 maps selected-User authorization inspection without an actor Session", () => {
    const inspection = authorizationInspectionFromResponse(create(InspectUserAuthorizationResponseSchema, {
      allowed: true,
      reasonCode: "allowed",
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      organizationId: "94944258-f6a2-4813-bd2e-3e4a38053021",
      roleKeys: ["owner"],
      authorizationVersion: BigInt(9),
      evaluatedAt: timestampFromDate(updatedAt),
    }));

    expect(inspection).toEqual({
      allowed: true,
      reasonCode: "allowed",
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      organizationId: "94944258-f6a2-4813-bd2e-3e4a38053021",
      roleKeys: ["owner"],
      authorizationVersion: BigInt(9),
      evaluatedAt: updatedAt,
    });
    expect(inspection).not.toHaveProperty("sessionId");
  });

  it("WEB-UNIT-RECORD-001 rejects malformed Role keys and inconsistent authorization decisions", () => {
    expect(() => roleFromRecord(create(RoleRecordSchema, {
      id: "4f7556a0-64ea-4da0-8996-d1f744035b75",
      organizationId: "94944258-f6a2-4813-bd2e-3e4a38053021",
      key: "Invalid-Viewer",
      name: "Viewer",
      description: "Read access",
      builtIn: true,
      status: "active",
      version: BigInt(1),
      permissionKeys: ["organization:read"],
    }))).toThrow("invalid IAM RoleRecord");

    expect(() => authorizationFromResponse(create(AuthorizeResponseSchema, {
      allowed: true,
      reasonCode: "permission_denied",
      userId: "bce7762a-f7c7-4d22-8031-4336803038eb",
      sessionId: "a237ca85-0634-4ce8-bd37-6d7bd90beaa8",
      organizationId: "94944258-f6a2-4813-bd2e-3e4a38053021",
      roleKeys: ["member"],
      authorizationVersion: BigInt(4),
      evaluatedAt: timestampFromDate(updatedAt),
    }))).toThrow("invalid IAM AuthorizeResponse");
  });
});

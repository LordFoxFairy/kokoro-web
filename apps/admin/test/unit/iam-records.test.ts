import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  OrganizationRecordSchema,
  PermissionRecordSchema,
  RoleRecordSchema,
  UserRecordSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import {
  AuthorizeResponseSchema,
  InspectUserAuthorizationResponseSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import {
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

  it("WEB-UNIT-RECORD-001 rejects unknown Role keys and inconsistent authorization decisions", () => {
    expect(() => roleFromRecord(create(RoleRecordSchema, {
      id: "4f7556a0-64ea-4da0-8996-d1f744035b75",
      organizationId: "94944258-f6a2-4813-bd2e-3e4a38053021",
      key: "viewer",
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

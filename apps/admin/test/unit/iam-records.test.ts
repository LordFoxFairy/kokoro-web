import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  OrganizationRecordSchema,
  UserRecordSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { organizationFromRecord, userFromRecord } from "../../server/iam/records";

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
});

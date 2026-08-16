import { describe, expect, it } from "vitest";

import { parseAuditFilters } from "../../modules/iam/audit/query";
import { memberCommandInputSchema } from "../../modules/iam/members/schema";
import { organizationCommandInputSchema } from "../../modules/iam/organizations/schema";

describe("Admin hostile boundary inputs", () => {
  it("WEB-SEC-INPUT-001 rejects control characters unknown keys and oversized commands", () => {
    expect(() => parseAuditFilters({ kind: "member.changed\r\ninjected" })).toThrow("invalid audit filters");
    expect(() => parseAuditFilters({ constructor: "polluted" })).toThrow("invalid audit filters");
    expect(memberCommandInputSchema.safeParse({ operation: "remove", __proto__: { admin: true } }).success).toBe(false);
    expect(organizationCommandInputSchema.safeParse({
      operation: "create",
      slug: "valid-org",
      name: "x".repeat(161),
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      reason: "valid reason",
    }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { manifestsSchema, user360Schema } from "./schemas";

describe("redeem-only user 360 wire", () => {
  it("does not expose payment orders", () => {
    const parsed = user360Schema.parse({ creditAccount: null, identity: null, orders: [{ id: "ord_1" }] });
    expect(parsed).not.toHaveProperty("orders");
  });
});

function nestedManifest(siteScopeField: unknown, includeField = true): unknown {
  const resource = {
    id: "accounts",
    labelKey: "admin.credit.accounts",
    route: "/admin/credits/accounts",
    actions: [],
    ...(includeField ? { siteScopeField } : {}),
  };
  return [{ id: "credit", online: true, manifest: { resources: [resource] } }];
}

describe("nested Admin manifest wire", () => {
  it("rejects a resource that omits siteScopeField", () => {
    expect(manifestsSchema.safeParse(nestedManifest(undefined, false)).success).toBe(false);
  });

  it("rejects an unsupported siteScopeField", () => {
    expect(manifestsSchema.safeParse(nestedManifest("tenantId")).success).toBe(false);
  });

  it.each([null, "siteId", "id"])("accepts siteScopeField=%s", (siteScopeField) => {
    const parsed = manifestsSchema.parse(nestedManifest(siteScopeField));
    expect(parsed[0]?.manifest?.resources?.[0]?.siteScopeField).toBe(siteScopeField);
  });
});

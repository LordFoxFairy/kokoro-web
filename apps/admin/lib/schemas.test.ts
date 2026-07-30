import { describe, expect, it } from "vitest";
import { manifestsSchema } from "./schemas";

function nestedManifest(siteScopeField: unknown, includeField = true): unknown {
  const resource = {
    id: "accounts",
    labelKey: "admin.site.resources.sites",
    route: "/admin/sites",
    actions: [],
    ...(includeField ? { siteScopeField } : {}),
  };
  return [{ id: "site", online: true, manifest: { resources: [resource] } }];
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

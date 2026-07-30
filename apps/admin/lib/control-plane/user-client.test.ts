import { describe, expect, it, vi } from "vitest";

async function subject() {
  const loaded = await import("./user-client").catch(() => null);
  expect(loaded).not.toBeNull();
  return loaded;
}

describe("typed Admin user reader", () => {
  it("selects one Site and returns only the exact requested user identity", async () => {
    const user = await subject(); if (user === null) return;
    const getUserWithinSite = vi.fn(async () => ({ user: {
      userRef: "user-one", status: "active", securityEpoch: 9_007_199_254_740_993n,
    } }));
    const context = { requestId: "request-one", scope: { kind: { case: "site", value: { siteIds: ["site-one"] } } } };
    const runtime = vi.fn(async () => ({ rpc: { getUserWithinSite }, context,
      headers: new Headers({ authorization: "Bearer sealed" }) }));
    const reader = user.createAdminUserReader(runtime as never);
    await expect(reader.getUserWithinSite("site-one", "user-one")).resolves.toEqual({
      siteId: "site-one", userRef: "user-one", status: "active", securityEpoch: "9007199254740993",
    });
    expect(runtime).toHaveBeenCalledWith("site-one");
    expect(getUserWithinSite).toHaveBeenCalledWith({ context,
      siteId: "site-one", userRef: "user-one" }, { headers: expect.any(Headers) });
  });

  it("rejects a mismatched user ref before exposing the response", async () => {
    const user = await subject(); if (user === null) return;
    const reader = user.createAdminUserReader(vi.fn(async () => ({ rpc: { getUserWithinSite: vi.fn(async () => ({
      user: { userRef: "user-other", status: "active", securityEpoch: 1n },
    })) }, context: { scope: { kind: { case: "site", value: { siteIds: ["site-one"] } } } },
    headers: new Headers() })) as never);
    await expect(reader.getUserWithinSite("site-one", "user-one")).rejects.toMatchObject({
      name: "AdminUserInvalidResponseError", domainCode: "admin_user.invalid_response",
    });
  });

  it("rejects a mismatched selected Site before issuing the RPC", async () => {
    const user = await subject(); if (user === null) return;
    const getUserWithinSite = vi.fn(async () => ({ user: {
      userRef: "user-one", status: "active", securityEpoch: 1n,
    } }));
    const reader = user.createAdminUserReader(vi.fn(async () => ({ rpc: { getUserWithinSite },
      context: { scope: { kind: { case: "site", value: { siteIds: ["site-other"] } } } },
      headers: new Headers() })) as never);
    await expect(reader.getUserWithinSite("site-one", "user-one")).rejects.toMatchObject({
      name: "AdminUserInvalidResponseError", domainCode: "admin_user.invalid_response",
    });
    expect(getUserWithinSite).not.toHaveBeenCalled();
  });
});

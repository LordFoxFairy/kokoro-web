import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserWithinSite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/control-plane/user-client", () => ({ adminUserReader: { getUserWithinSite } }));

beforeEach(() => {
  getUserWithinSite.mockReset();
  getUserWithinSite.mockResolvedValue({ siteId: "site-one", userRef: "user-one", status: "active",
    securityEpoch: "1" });
});

describe("typed Admin user BFF", () => {
  it("binds one Site and one user ref with no generic fan-out", async () => {
    const route = await import("../app/api/control/users/[userRef]/route").catch(() => null);
    expect(route).not.toBeNull(); if (route === null) return;
    const response = await route.GET(new Request("https://admin.example/api/control/users/user-one?siteId=site-one"),
      { params: Promise.resolve({ userRef: "user-one" }) });
    expect(response.status).toBe(200);
    expect(getUserWithinSite).toHaveBeenCalledWith("site-one", "user-one");
  });

  it("rejects duplicate, missing and oversized query identities before RPC", async () => {
    const route = await import("../app/api/control/users/[userRef]/route").catch(() => null);
    expect(route).not.toBeNull(); if (route === null) return;
    const duplicate = await route.GET(new Request(
      "https://admin.example/api/control/users/user-one?siteId=site-one&siteId=site-two"),
    { params: Promise.resolve({ userRef: "user-one" }) });
    const oversized = await route.GET(new Request(
      `https://admin.example/api/control/users/${"u".repeat(129)}?siteId=site-one`),
    { params: Promise.resolve({ userRef: "u".repeat(129) }) });
    expect([duplicate.status, oversized.status]).toEqual([400, 400]);
    expect(getUserWithinSite).not.toHaveBeenCalled();
  });
});

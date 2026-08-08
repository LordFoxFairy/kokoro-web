import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  listSites: vi.fn(), getSite: vi.fn(), registerSite: vi.fn(), publishSiteRelease: vi.fn(), getAuditWithinScope: vi.fn(),
  listOperators: vi.fn(), listPendingApprovals: vi.fn(),
}));

vi.mock("@/lib/control-plane/client", () => ({
  AdminControlPlaneError: class AdminControlPlaneError extends Error {},
  ...calls,
}));

beforeEach(() => {
  vi.clearAllMocks();
  calls.listSites.mockResolvedValue({ items: [], nextPageToken: null });
  calls.getSite.mockResolvedValue({ siteRef: "site-one", status: "preview_ready", securityEpoch: "1" });
  calls.registerSite.mockResolvedValue({ siteId: "site-one" });
  calls.publishSiteRelease.mockResolvedValue({ siteId: "site-one", releaseRef: "release-001" });
  calls.getAuditWithinScope.mockResolvedValue({ items: [], nextPageToken: null });
  calls.listOperators.mockResolvedValue({ items: [], nextPageToken: null });
  calls.listPendingApprovals.mockResolvedValue({ items: [], nextPageToken: null });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) });
}

describe("typed Site control routes", () => {
  it("lists Sites under the current authority scope", async () => {
    const route = await import("../app/api/control/sites/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const pageToken = "x".repeat(1_024);
    const response = await route.GET(new Request(`https://admin.example/api/control/sites?pageToken=${pageToken}`));
    expect(response.status).toBe(200);
    expect(calls.listSites).toHaveBeenCalledWith(pageToken);
  });

  it.each([
    "https://admin.example/api/control/sites?unknown=value",
    "https://admin.example/api/control/sites?pageToken=one&pageToken=two",
    "https://admin.example/api/control/sites?pageToken=",
    `https://admin.example/api/control/sites?pageToken=${"x".repeat(1_025)}`,
    `https://admin.example/api/control/sites?pageToken=${"x".repeat(4_097)}`,
  ])("rejects non-canonical Site list queries: %s", async (url) => {
    const route = await import("../app/api/control/sites/route");
    const response = await route.GET(new Request(url));
    expect(response.status).toBe(400);
    expect(calls.listSites).not.toHaveBeenCalled();
  });

  it("gets one request-selected Site through AdminQuery", async () => {
    const route = await import("../app/api/control/sites/[siteId]/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const response = await route.GET(new Request("https://admin.example/api/control/sites/site-one"),
      { params: Promise.resolve({ siteId: "site-one" }) });
    expect(response.status).toBe(200);
    expect(calls.getSite).toHaveBeenCalledWith("site-one");
  });

  it("rejects query parameters on the Site detail route", async () => {
    const route = await import("../app/api/control/sites/[siteId]/route");
    const response = await route.GET(new Request("https://admin.example/api/control/sites/site-one?unexpected=1"),
      { params: Promise.resolve({ siteId: "site-one" }) });
    expect(response.status).toBe(400);
    expect(calls.getSite).not.toHaveBeenCalled();
  });

  it("rejects an over-budget query on the Site detail route", async () => {
    const route = await import("../app/api/control/sites/[siteId]/route");
    const response = await route.GET(new Request(`https://admin.example/api/control/sites/site-one?x=${"y".repeat(4_097)}`),
      { params: Promise.resolve({ siteId: "site-one" }) });
    expect(response.status).toBe(400);
    expect(calls.getSite).not.toHaveBeenCalled();
  });

  it("registers the first Site from a complete strict request", async () => {
    const route = await import("../app/api/control/sites/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const input = { siteId: "site-one", siteKey: "site-one", projectBindingRef: "project-binding:one",
      repositoryRef: "github:example/site-one", providerNamespace: "example.production",
      providerProjectRef: "provider-project:one", workloadIdentityRef: "spiffe://example/site-one" };
    const response = await route.POST(jsonRequest("https://admin.example/api/control/sites", input));
    expect(response.status).toBe(201);
    expect(calls.registerSite).toHaveBeenCalledWith(input);
  });

  it("publishes one exact authorized release candidate and rejects retired inline release facts", async () => {
    const route = await import("../app/api/control/sites/releases/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const input = { siteId: "site-one", candidateRef: "site-release-candidate:one",
      candidateVersion: "7", candidateAuthorizationEpoch: "3",
      candidateDigest: `sha256:${"a".repeat(64)}`, reason: "Publish the reviewed candidate" };
    const response = await route.POST(jsonRequest("https://admin.example/api/control/sites/releases", input));
    expect(response.status).toBe(201);
    expect(calls.publishSiteRelease).toHaveBeenCalledWith(input);

    const rejected = await route.POST(jsonRequest("https://admin.example/api/control/sites/releases",
      { ...input, releaseRef: "retired-inline-release" }));
    expect(rejected.status).toBe(400);
    const malformedVersion = await route.POST(jsonRequest("https://admin.example/api/control/sites/releases",
      { ...input, candidateVersion: "not-a-number" }));
    expect(malformedVersion.status).toBe(400);
    expect(calls.publishSiteRelease).toHaveBeenCalledTimes(1);
  });
});

describe("typed Audit control route", () => {
  it("narrows the query context to the browser-selected Site", async () => {
    const route = await import("../app/api/control/audit/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const pageToken = "x".repeat(1_024);
    const response = await route.GET(new Request(
      `https://admin.example/api/control/audit?siteId=site-one&pageToken=${pageToken}`,
    ));
    expect(response.status).toBe(200);
    expect(calls.getAuditWithinScope).toHaveBeenCalledWith("site-one", pageToken);
  });

  it.each([
    "https://admin.example/api/control/audit?unexpected=1",
    "https://admin.example/api/control/audit?siteId=one&siteId=two",
    "https://admin.example/api/control/audit?pageToken=one&pageToken=two",
    "https://admin.example/api/control/audit?siteId=",
    "https://admin.example/api/control/audit?pageToken=",
    `https://admin.example/api/control/audit?pageToken=${"x".repeat(1_025)}`,
    `https://admin.example/api/control/audit?pageToken=${"x".repeat(4_097)}`,
  ])("rejects non-canonical Audit queries: %s", async (url) => {
    const route = await import("../app/api/control/audit/route");
    const response = await route.GET(new Request(url));
    expect(response.status).toBe(400);
    expect(calls.getAuditWithinScope).not.toHaveBeenCalled();
  });
});

describe("typed Refine resource control routes", () => {
  it("forwards exact Operator and Approval cursors to AdminQuery", async () => {
    const operators = await import("../app/api/control/operators/route");
    const approvals = await import("../app/api/control/approvals/route");
    const pageToken = "x".repeat(1_024);

    expect((await operators.GET(new Request(
      `https://admin.example/api/control/operators?pageToken=${pageToken}`,
    ))).status).toBe(200);
    expect(calls.listOperators).toHaveBeenCalledWith(pageToken);
    expect((await approvals.GET(new Request(
      `https://admin.example/api/control/approvals?siteId=site-one&pageToken=${pageToken}`,
    ))).status).toBe(200);
    expect(calls.listPendingApprovals).toHaveBeenCalledWith("site-one", pageToken);
  });

  it.each([
    "https://admin.example/api/control/operators?unexpected=1",
    "https://admin.example/api/control/operators?pageToken=one&pageToken=two",
    "https://admin.example/api/control/operators?pageToken=",
    `https://admin.example/api/control/operators?pageToken=${"x".repeat(1_025)}`,
  ])("rejects non-canonical Operator list queries: %s", async (url) => {
    const operators = await import("../app/api/control/operators/route");
    const response = await operators.GET(new Request(url));
    expect(response.status).toBe(400);
    expect(calls.listOperators).not.toHaveBeenCalled();
  });

  it.each([
    "https://admin.example/api/control/approvals?unexpected=1",
    "https://admin.example/api/control/approvals?siteId=one&siteId=two",
    "https://admin.example/api/control/approvals?pageToken=one&pageToken=two",
    "https://admin.example/api/control/approvals?siteId=",
    "https://admin.example/api/control/approvals?pageToken=",
    `https://admin.example/api/control/approvals?pageToken=${"x".repeat(1_025)}`,
  ])("rejects non-canonical Approval list queries: %s", async (url) => {
    const approvals = await import("../app/api/control/approvals/route");
    const response = await approvals.GET(new Request(url));
    expect(response.status).toBe(400);
    expect(calls.listPendingApprovals).not.toHaveBeenCalled();
  });
});

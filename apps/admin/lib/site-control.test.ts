import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  listSites: vi.fn(), getSite: vi.fn(), registerSite: vi.fn(), publishSiteRelease: vi.fn(), getAuditWithinScope: vi.fn(),
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
    const response = await route.GET(new Request("https://admin.example/api/control/sites?pageToken=next"));
    expect(response.status).toBe(200);
    expect(calls.listSites).toHaveBeenCalledWith("next");
  });

  it.each([
    "https://admin.example/api/control/sites?unknown=value",
    "https://admin.example/api/control/sites?pageToken=one&pageToken=two",
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

  it("submits complete externally signed release facts without accepting a private key", async () => {
    const route = await import("../app/api/control/sites/releases/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const input = { siteId: "site-one", releaseRef: "release-001", webArtifactDigest: "a".repeat(64),
      releaseManifestDigest: "b".repeat(64), certificationDigest: "c".repeat(64),
      launchProfileRef: "launch-profile:one", siteConfigRevisionRef: "site-config:one",
      legalRevisionRef: "legal:one", featurePolicyRevision: "features:one",
      modelOptionCatalogRef: "model-options:one", agentCatalogRef: "agents:one", identityIssuerLabel: "example",
      identityAuthStrengthPolicyRevision: "auth-strength:one", enabledSurfaceIds: ["chat"],
      localePolicy: { defaultLocale: "en", allowedLocales: ["en", "zh-CN"] },
      certification: { signingKeyRef: "release-key:one", issuedAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2026-07-31T00:00:00.000Z", signatureBase64: Buffer.alloc(64, 7).toString("base64") } };
    const response = await route.POST(jsonRequest("https://admin.example/api/control/sites/releases", input));
    expect(response.status).toBe(201);
    expect(calls.publishSiteRelease).toHaveBeenCalledWith(input);

    const rejected = await route.POST(jsonRequest("https://admin.example/api/control/sites/releases",
      { ...input, signingPrivateKey: "never-accepted" }));
    expect(rejected.status).toBe(400);
    expect(calls.publishSiteRelease).toHaveBeenCalledTimes(1);
  });
});

describe("typed Audit control route", () => {
  it("narrows the query context to the browser-selected Site", async () => {
    const route = await import("../app/api/control/audit/route").catch(() => null);
    expect(route).not.toBeNull();
    if (route === null) return;
    const response = await route.GET(new Request("https://admin.example/api/control/audit?siteId=site-one&pageToken=next"));
    expect(response.status).toBe(200);
    expect(calls.getAuditWithinScope).toHaveBeenCalledWith("site-one", "next");
  });

  it.each([
    "https://admin.example/api/control/audit?unexpected=1",
    "https://admin.example/api/control/audit?siteId=one&siteId=two",
    "https://admin.example/api/control/audit?pageToken=one&pageToken=two",
  ])("rejects non-canonical Audit queries: %s", async (url) => {
    const route = await import("../app/api/control/audit/route");
    const response = await route.GET(new Request(url));
    expect(response.status).toBe(400);
    expect(calls.getAuditWithinScope).not.toHaveBeenCalled();
  });
});

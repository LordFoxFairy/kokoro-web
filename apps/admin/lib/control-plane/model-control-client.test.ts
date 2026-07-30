import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandReceiptStateV2 } from
  "@/lib/generated/admin-commerce/kokoro/common/v2/command_envelope_pb";
import { MODEL_CONTROL_ADMIN_ERRORS, modelControlAdminErrorDetail } from
  "@/lib/generated/model-control/model-control-errors";

const calls = vi.hoisted(() => ({
  model: {
    getInventoryRevision: vi.fn(),
    listInventoryRevisions: vi.fn(),
    listSiteModelPolicies: vi.fn(),
    listSiteReleaseCatalogs: vi.fn(),
    activateInventory: vi.fn(),
    changeSitePolicy: vi.fn(),
    publishSiteReleaseCatalog: vi.fn(),
  },
  requireAuthoritySession: vi.fn(),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => ({
  ...await importOriginal<typeof import("@connectrpc/connect")>(),
  createClient: vi.fn(() => calls.model),
}));
vi.mock("./transport", () => ({ adminControlPlaneTransport: vi.fn(async () => ({})) }));
vi.mock("./authority-session", () => ({ requireAuthoritySession: calls.requireAuthoritySession }));

const instant = { seconds: 1_774_915_200n, nanos: 0 };
const digest = "a".repeat(64);
const session = {
  operatorRef: "operator-one", operatorGeneration: "1", operatorSessionRef: "session-one",
  credential: "x".repeat(32), workloadIdentityRef: "spiffe://example/admin", audience: "platform-admin",
  environment: "production", region: "us-east-1", managedDeviceRef: "device-one",
  operatorSecurityEpoch: "1", sessionEpoch: "1", restrictionEpoch: "1", policyEpoch: "1",
  assuranceLevel: "phishing_resistant", factorClasses: ["webauthn"],
  authenticatedAt: "2026-07-30T00:00:00.000Z", stepUpAt: "2026-07-30T00:01:00.000Z",
  operatorAttestationRef: "admin-session:session-one:1", operatorAttestationDigest: "b".repeat(64),
  expiresAt: "2026-07-30T01:00:00.000Z", permissions: ["model.read"],
  scope: { kind: "site", siteIds: ["site-one"], environment: "production", region: "us-east-1" },
  globalScope: { grantId: "global-one", environment: "production", region: "us-east-1" },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  calls.requireAuthoritySession.mockResolvedValue(session);
});

describe("typed Model query client", () => {
  it("positively projects the required GetInventoryRevision fields", async () => {
    calls.model.getInventoryRevision.mockResolvedValue({
      revision: { inventoryDigest: digest, sourceReference: "catalog:one",
        counts: { providers: 1, models: 2, bindings: 3, productRoutes: 0 }, importedAt: instant,
        active: true, activePointerRevision: 9n }, asOf: instant,
    });
    const { getModelInventoryRevision } = await import("./client");

    await expect(getModelInventoryRevision(digest)).resolves.toEqual({
      inventoryDigest: digest,
      sourceReference: "catalog:one",
      counts: { providers: 1, models: 2, bindings: 3, productRoutes: 0 },
      importedAt: "2026-03-31T00:00:00.000Z",
      active: true,
      activePointerRevision: "9",
      asOf: "2026-03-31T00:00:00.000Z",
    });
  });

  it("rejects a GetInventoryRevision response for a different immutable digest", async () => {
    calls.model.getInventoryRevision.mockResolvedValue({
      revision: { inventoryDigest: "c".repeat(64), sourceReference: "catalog:other",
        counts: { providers: 1, models: 1, bindings: 1, productRoutes: 0 }, importedAt: instant,
        active: false }, asOf: instant,
    });
    const { getModelInventoryRevision } = await import("./client");

    await expect(getModelInventoryRevision(digest)).rejects.toMatchObject({
      connectCode: Code.Internal,
      domainCode: "admin_control_plane.invalid_response",
    });
  });

  it("preserves the generated provider NotFound detail through the client and HTTP boundary", async () => {
    const contract = MODEL_CONTROL_ADMIN_ERRORS.inventoryRevisionNotFound;
    calls.model.getInventoryRevision.mockRejectedValue(new ConnectError(contract.safeMessage, Code.NotFound,
      undefined, [modelControlAdminErrorDetail("inventoryRevisionNotFound", "request-one")]));
    const { getModelInventoryRevision } = await import("./client");
    const { controlError } = await import("./http");

    const error = await getModelInventoryRevision(digest).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      connectCode: Code.NotFound,
      domainCode: contract.domainCode,
    });
    const response = controlError(error);
    expect(response.status).toBe(contract.httpStatus);
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null } });
  });

  it("preserves the generated provider page-token InvalidArgument through HTTP", async () => {
    const contract = MODEL_CONTROL_ADMIN_ERRORS.adminPageTokenInvalid;
    calls.model.listInventoryRevisions.mockRejectedValue(new ConnectError(contract.safeMessage,
      Code.InvalidArgument, undefined, [modelControlAdminErrorDetail("adminPageTokenInvalid", "request-two")]));
    const { listModelInventoryRevisions } = await import("./client");
    const { controlError } = await import("./http");

    const error = await listModelInventoryRevisions("malformed").catch((reason: unknown) => reason);
    expect(error).toMatchObject({ connectCode: Code.InvalidArgument, domainCode: contract.domainCode });
    const response = controlError(error);
    expect(response.status).toBe(contract.httpStatus);
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null } });
  });

  it.each(["policies", "catalogs"])("rejects a cross-Site row in %s", async (kind) => {
    const page = { nextPageToken: undefined, asOf: instant };
    calls.model.listSiteModelPolicies.mockResolvedValue({ policies: [{ siteId: "site-other", product: 1,
      revision: 1n, policyDigest: digest, enabled: true, catalogMode: 1, assignmentMode: 1,
      assignmentCount: 0, current: true, changedAt: instant }], page });
    calls.model.listSiteReleaseCatalogs.mockResolvedValue({ catalogs: [{ siteId: "site-other",
      siteReleaseRef: "release:one", modelOptionCatalogRef: "catalog:one", catalogDigest: digest,
      inventoryDigest: digest, surfaceCount: 1, publishedAt: instant }], page });
    const client = await import("./client");
    const request = kind === "policies" ? client.listModelSitePolicies("site-one")
      : client.listModelSiteReleaseCatalogs("site-one");

    await expect(request).rejects.toMatchObject({
      connectCode: Code.Internal,
      domainCode: "admin_control_plane.invalid_response",
    });
  });
});

describe("typed Model Site mutation client", () => {
  const receipt = (request: unknown) => {
    const context = (request as { context: { command?: { commandId: string; requestDigest: string } } }).context;
    return { state: CommandReceiptStateV2.COMMITTED, identity: context.command,
      operation: "model.test", recordedAt: instant };
  };

  it("preserves the generated provider receipt conflict through the client and HTTP boundary", async () => {
    const contract = MODEL_CONTROL_ADMIN_ERRORS.commandReceiptConflict;
    calls.model.activateInventory.mockRejectedValue(new ConnectError(contract.safeMessage, Code.AlreadyExists,
      undefined, [modelControlAdminErrorDetail("commandReceiptConflict", "request-three")]));
    const { activateModelInventory } = await import("./client");
    const { controlError } = await import("./http");

    const error = await activateModelInventory(digest, "0").catch((reason: unknown) => reason);
    expect(error).toMatchObject({ connectCode: Code.AlreadyExists, domainCode: contract.domainCode });
    const response = controlError(error);
    expect(response.status).toBe(contract.httpStatus);
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null } });
  });

  it("rejects a cross-Site policy response after validating its receipt", async () => {
    calls.model.changeSitePolicy.mockImplementation(async (request: unknown) => ({ siteId: "site-other",
      policyDigest: digest, revision: 1n, replayed: false, receipt: receipt(request) }));
    const { changeModelSitePolicy } = await import("./client");

    await expect(changeModelSitePolicy({ siteId: "site-one", product: "chat", enabled: true,
      catalogMode: "follow_active", assignmentMode: "inherit", expectedRevision: "0", assignments: [],
    })).rejects.toMatchObject({ connectCode: Code.Internal, domainCode: "admin_control_plane.invalid_response" });
  });

  it("rejects a cross-Site release catalog response after validating its receipt", async () => {
    calls.model.publishSiteReleaseCatalog.mockImplementation(async (request: unknown) => ({ siteId: "site-other",
      siteReleaseRef: "release:one", modelOptionCatalogRef: "catalog:one", catalogDigest: digest,
      publishedAt: instant, replayed: false, receipt: receipt(request) }));
    const { publishModelSiteReleaseCatalog } = await import("./client");

    await expect(publishModelSiteReleaseCatalog({ siteId: "site-one", siteReleaseRef: "release:one",
      inventoryDigest: digest, surfaces: [{ surface: "chat", allowedOptionRevisionRefs: ["option:one"],
        defaultModelOptionRevisionRef: "option:one" }],
    })).rejects.toMatchObject({ connectCode: Code.Internal, domainCode: "admin_control_plane.invalid_response" });
  });
});

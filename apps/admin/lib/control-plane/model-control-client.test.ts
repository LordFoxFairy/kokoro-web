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
    importInventory: vi.fn(),
    materializeModelOptions: vi.fn(),
    getCommandReceipt: vi.fn(),
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
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null,
      recoveryRef: null } });
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
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null,
      recoveryRef: null } });
  });

  it.each([
    ["adminSessionUnauthenticated", Code.Unauthenticated],
    ["adminPermissionDenied", Code.PermissionDenied],
  ] as const)("preserves the generated provider %s classification through HTTP", async (kind, code) => {
    const contract = MODEL_CONTROL_ADMIN_ERRORS[kind];
    calls.model.getInventoryRevision.mockRejectedValue(new ConnectError(contract.safeMessage, code,
      undefined, [modelControlAdminErrorDetail(kind, `request-${kind}`)]));
    const { getModelInventoryRevision } = await import("./client");
    const { controlError } = await import("./http");

    const error = await getModelInventoryRevision(digest).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ connectCode: code, domainCode: contract.domainCode });
    const response = controlError(error);
    expect(response.status).toBe(contract.httpStatus);
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null,
      recoveryRef: null } });
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

  it.each([0, 99])("rejects unspecified or unknown Model enums (%s)", async (product) => {
    calls.model.listSiteModelPolicies.mockResolvedValue({ policies: [{ siteId: "site-one", product,
      revision: 1n, policyDigest: digest, enabled: true, catalogMode: 1, assignmentMode: 1,
      assignmentCount: 0, current: true, changedAt: instant }],
    page: { nextPageToken: undefined, asOf: instant } });
    const { listModelSitePolicies } = await import("./client");

    await expect(listModelSitePolicies("site-one")).rejects.toMatchObject({
      connectCode: Code.Internal, domainCode: "admin_control_plane.invalid_response",
    });
  });
});

describe("typed Model Site mutation client", () => {
  const receipt = (request: unknown, operation = "model.test") => {
    const context = (request as { context: { command?: { commandId: string; requestDigest: string } } }).context;
    return { state: CommandReceiptStateV2.COMMITTED, identity: context.command,
      operation, recordedAt: instant };
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
    expect(await response.json()).toEqual({ error: { code: contract.domainCode, receiptRef: null,
      recoveryRef: null } });
  });

  it("rejects a cross-Site policy response after validating its receipt", async () => {
    calls.model.changeSitePolicy.mockImplementation(async (request: unknown) => ({ siteId: "site-other",
      policyDigest: digest, revision: 1n, replayed: false,
      receipt: receipt(request, "model.site-policy.change") }));
    const { changeModelSitePolicy } = await import("./client");

    await expect(changeModelSitePolicy({ siteId: "site-one", product: "chat", enabled: true,
      catalogMode: "follow_active", assignmentMode: "inherit", expectedRevision: "0", assignments: [],
    })).rejects.toMatchObject({ connectCode: Code.Internal, domainCode: "admin_control_plane.invalid_response" });
  });

  it("rejects a cross-Site release catalog response after validating its receipt", async () => {
    calls.model.publishSiteReleaseCatalog.mockImplementation(async (request: unknown) => ({ siteId: "site-other",
      siteReleaseRef: "release:one", modelOptionCatalogRef: "catalog:one", catalogDigest: digest,
      publishedAt: instant, replayed: false,
      receipt: receipt(request, "model.site-release-catalog.publish") }));
    const { publishModelSiteReleaseCatalog } = await import("./client");

    await expect(publishModelSiteReleaseCatalog({ siteId: "site-one", siteReleaseRef: "release:one",
      inventoryDigest: digest, surfaces: [{ surface: "chat", allowedOptionRevisionRefs: ["option:one"],
        defaultModelOptionRevisionRef: "option:one" }],
    })).rejects.toMatchObject({ connectCode: Code.Internal, domainCode: "admin_control_plane.invalid_response" });
  });

  it("reconciles an ambiguous activation with the same canonical UUIDv4 command and request ID", async () => {
    calls.model.activateInventory.mockRejectedValueOnce(new ConnectError("ambiguous", Code.Unavailable));
    calls.model.getCommandReceipt.mockImplementation(async (request: unknown, options: { headers: Headers }) => {
      const input = request as { commandId: string; digestAlgorithm: number; requestDigest: string };
      expect(input.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      expect(input.digestAlgorithm).toBe(1);
      expect(input.requestDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(options.headers.get("x-request-id")).toBe(input.commandId);
      return { receipt: { state: CommandReceiptStateV2.COMMITTED,
        identity: { commandId: input.commandId, digestAlgorithm: 1, requestDigest: input.requestDigest },
        operation: "model.inventory.activate", recordedAt: instant },
      result: { case: "activateInventory", value: { targetDigest: digest, activatedRevision: 4n } } };
    });
    const { activateModelInventory } = await import("./client");

    const result = await activateModelInventory(digest, "3");

    const [effectRequest, effectOptions] = calls.model.activateInventory.mock.calls[0] as
      [{ context: { command: { commandId: string } } }, { headers: Headers }];
    expect(effectRequest.context.command.commandId)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(effectOptions.headers.get("x-request-id")).toBe(effectRequest.context.command.commandId);
    expect(calls.model.activateInventory).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ targetDigest: digest, activatedRevision: "4",
      receipt: { commandId: effectRequest.context.command.commandId } });
  });

  it("returns an opaque durable recovery reference and can reconcile it later", async () => {
    calls.model.activateInventory.mockRejectedValueOnce(new ConnectError("ambiguous", Code.DeadlineExceeded));
    const contract = MODEL_CONTROL_ADMIN_ERRORS.commandReceiptNotFound;
    calls.model.getCommandReceipt.mockRejectedValueOnce(new ConnectError(contract.safeMessage, Code.NotFound,
      undefined, [modelControlAdminErrorDetail("commandReceiptNotFound", "receipt-query")]));
    const { activateModelInventory, reconcileModelCommandRecovery } = await import("./client");

    const error = await activateModelInventory(digest, "3").catch((reason: unknown) => reason);

    expect(error).toMatchObject({ connectCode: Code.DeadlineExceeded,
      receiptRef: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      recoveryRef: expect.stringMatching(/^[A-Za-z0-9_-]{1,1024}$/u) });
    const { receiptRef, recoveryRef } = error as { receiptRef: string; recoveryRef: string };
    expect(JSON.parse(Buffer.from(recoveryRef, "base64url").toString("utf8"))).toEqual({
      version: 1, commandId: receiptRef, operation: "activate_inventory",
      digestAlgorithm: "SHA256_COMMAND_ENVELOPE", requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      siteId: null,
    });
    expect(calls.model.activateInventory).toHaveBeenCalledTimes(1);
    expect(calls.model.getCommandReceipt.mock.calls[0]?.[0]).toMatchObject({ commandId: receiptRef });
    expect(calls.model.getCommandReceipt.mock.calls[0]?.[0]).toMatchObject({
      digestAlgorithm: 1, requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    calls.model.getCommandReceipt.mockImplementationOnce(async (request: unknown) => {
      const input = request as { commandId: string; digestAlgorithm: number; requestDigest: string };
      return { receipt: { state: CommandReceiptStateV2.COMMITTED,
        identity: { commandId: input.commandId, digestAlgorithm: input.digestAlgorithm,
          requestDigest: input.requestDigest }, operation: "model.inventory.activate", recordedAt: instant },
      result: { case: "activateInventory", value: { targetDigest: digest, activatedRevision: 4n } } };
    });

    await expect(reconcileModelCommandRecovery(recoveryRef)).resolves.toMatchObject({
      operation: "activate_inventory", result: { targetDigest: digest, activatedRevision: "4" },
    });
    expect(calls.model.getCommandReceipt).toHaveBeenCalledTimes(2);
  });

  it.each([0, 99])("rejects Model effect and reconciliation receipts with digest algorithm %s", async (algorithm) => {
    calls.model.activateInventory.mockImplementationOnce(async (request: unknown) => {
      const value = receipt(request, "model.inventory.activate");
      return { targetDigest: digest, activatedRevision: 1n, replayed: false,
        receipt: { ...value, identity: { ...value.identity, digestAlgorithm: algorithm } } };
    });
    const client = await import("./client");

    await expect(client.activateModelInventory(digest, "0")).rejects.toMatchObject({ connectCode: Code.Internal });

    const commandId = "018f23d4-52aa-4c36-8b2c-2df90cf76953";
    calls.model.getCommandReceipt.mockResolvedValueOnce({ receipt: { state: CommandReceiptStateV2.COMMITTED,
      identity: { commandId, digestAlgorithm: algorithm, requestDigest: digest },
      operation: "model.inventory.activate", recordedAt: instant },
    result: { case: "activateInventory", value: { targetDigest: digest, activatedRevision: 1n } } });
    await expect(client.getModelCommandReceipt({ commandId, requestDigest: digest,
      operation: "activate_inventory" })).rejects.toMatchObject({ connectCode: Code.Internal });
  });

  it("preserves and validates materialization source digests in immediate and recovered results", async () => {
    const sourceDigest = "b".repeat(64);
    calls.model.materializeModelOptions.mockImplementationOnce(async (request: unknown) => ({
      inventoryDigest: digest, sourceDigest, materializationDigest: "c".repeat(64),
      optionRevisionRefs: ["option:one"], replayed: false,
      receipt: receipt(request, "model.option.materialize"),
    }));
    const client = await import("./client");
    const input = { inventoryDigest: digest, options: [{ optionKey: "chat-one", surface: "chat" as const,
      label: "Chat", lifecycle: "active" as const,
      orchestration: { primaryModelKey: "model-one", fallbackModelKeys: [] },
      generation: { primaryModelKey: "model-one", fallbackModelKeys: [] } }] };

    await expect(client.materializeModelOptions(input)).resolves.toMatchObject({ sourceDigest });

    const commandId = "018f23d4-52aa-4c36-8b2c-2df90cf76953";
    calls.model.getCommandReceipt.mockResolvedValueOnce({ receipt: { state: CommandReceiptStateV2.COMMITTED,
      identity: { commandId, digestAlgorithm: 1, requestDigest: digest },
      operation: "model.option.materialize", recordedAt: instant },
    result: { case: "materializeModelOptions", value: { inventoryDigest: digest, sourceDigest,
      materializationDigest: "c".repeat(64), optionRevisionRefs: ["option:one"] } } });
    await expect(client.getModelCommandReceipt({ commandId, requestDigest: digest,
      operation: "materialize_options" })).resolves.toMatchObject({ result: { sourceDigest } });

    calls.model.materializeModelOptions.mockImplementationOnce(async (request: unknown) => ({
      inventoryDigest: digest, sourceDigest: "invalid", materializationDigest: "c".repeat(64),
      optionRevisionRefs: ["option:one"], replayed: false,
      receipt: receipt(request, "model.option.materialize"),
    }));
    await expect(client.materializeModelOptions(input)).rejects.toMatchObject({ connectCode: Code.Internal });
  });

  it.each(["", "not+base64url", "a".repeat(1025), "eyJ2ZXJzaW9uIjoyfQ"])(
    "rejects malformed or noncanonical recovery references: %s", async (recoveryRef) => {
      const { reconcileModelCommandRecovery } = await import("./client");
      await expect(reconcileModelCommandRecovery(recoveryRef)).rejects.toMatchObject({
        connectCode: Code.InvalidArgument, domainCode: "model.command_receipt.recovery_ref_invalid",
      });
      expect(calls.model.getCommandReceipt).not.toHaveBeenCalled();
    });

  it("rejects effect responses whose immutable identity does not match the request", async () => {
    calls.model.activateInventory.mockImplementation(async (request: unknown) => ({
      targetDigest: "f".repeat(64), activatedRevision: 1n, replayed: false,
      receipt: receipt(request, "model.inventory.activate"),
    }));
    calls.model.materializeModelOptions.mockImplementation(async (request: unknown) => ({
      inventoryDigest: "f".repeat(64), sourceDigest: digest, materializationDigest: digest,
      optionRevisionRefs: ["option:one"], replayed: false,
      receipt: receipt(request, "model.option.materialize"),
    }));
    calls.model.publishSiteReleaseCatalog.mockImplementation(async (request: unknown) => ({
      siteId: "site-one", siteReleaseRef: "release:other", modelOptionCatalogRef: "catalog:one",
      catalogDigest: digest, publishedAt: instant, replayed: false,
      receipt: receipt(request, "model.site-release-catalog.publish"),
    }));
    const client = await import("./client");

    await expect(client.activateModelInventory(digest, "0")).rejects.toMatchObject({ connectCode: Code.Internal });
    await expect(client.materializeModelOptions({ inventoryDigest: digest, options: [{ optionKey: "chat-one",
      surface: "chat", label: "Chat", lifecycle: "active",
      orchestration: { primaryModelKey: "model-one", fallbackModelKeys: [] },
      generation: { primaryModelKey: "model-one", fallbackModelKeys: [] } }] }))
      .rejects.toMatchObject({ connectCode: Code.Internal });
    await expect(client.publishModelSiteReleaseCatalog({ siteId: "site-one", siteReleaseRef: "release:one",
      inventoryDigest: digest, surfaces: [{ surface: "chat", allowedOptionRevisionRefs: ["option:one"],
        defaultModelOptionRevisionRef: "option:one" }] }))
      .rejects.toMatchObject({ connectCode: Code.Internal });
  });
});

import { randomUUID } from "node:crypto";

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";

import {
  AdminAuthClientError,
  createAdminAuthClient,
  createAdminAuthTransport,
} from "@/lib/auth/client";
import { contractMetadata } from "@/lib/generated/contracts/contract-metadata";
import { ADMIN_AUTH_COMMAND_DIGEST_ALGORITHM } from "@/lib/generated/contracts/admin-auth-effect-digest";
import { KokoroErrorDetailSchema } from "@/lib/generated/contracts/kokoro/common/v1/error_pb";
import { AdminAuthService } from "@/lib/generated/contracts/kokoro/platform/admin/v1/admin_auth_pb";

interface LiveConfig {
  gatewayUrl: string;
  proxySecret: string;
  contractDigest: string;
}

function assertContractDigest(expected: string): void {
  if (expected !== contractMetadata.artifactDigestSha256) {
    throw new Error("admin_auth_contract_digest_mismatch");
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`admin_auth_live_env_missing:${name}`);
  return value;
}

function liveConfig(): LiveConfig {
  const contractDigest = requiredEnvironment("KOKORO_ADMIN_AUTH_CONTRACT_DIGEST");
  assertContractDigest(contractDigest);
  return {
    gatewayUrl: requiredEnvironment("KOKORO_GATEWAY_URL"),
    proxySecret: requiredEnvironment("KOKORO_ADMIN_PROXY_SECRET"),
    contractDigest,
  };
}

function metadataInterceptor(options: { audience: string; proxySecret?: string }): Interceptor {
  return (next) => async (request) => {
    request.header.set("x-kokoro-workload", "admin-web");
    request.header.set("x-kokoro-audience", options.audience);
    request.header.set("x-kokoro-environment", "test");
    if (options.proxySecret !== undefined) {
      request.header.set("x-kokoro-proxy-secret", options.proxySecret);
    }
    return next(request);
  };
}

function rawTransport(gatewayUrl: string, interceptors: Interceptor[]): Transport {
  return createConnectTransport({
    baseUrl: gatewayUrl,
    httpVersion: "1.1",
    useBinaryFormat: false,
    defaultTimeoutMs: 5_000,
    readMaxBytes: 64 * 1024,
    writeMaxBytes: 64 * 1024,
    interceptors,
  });
}

async function connectFailure(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected_connect_failure");
}

async function clientFailure(promise: Promise<unknown>): Promise<AdminAuthClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdminAuthClientError);
    return error as AdminAuthClientError;
  }
  throw new Error("expected_client_failure");
}

function loseFirstCreateResponse(transport: Transport): Transport {
  let lost = false;
  return {
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      const response = await transport.unary(method, signal, timeoutMs, header, input, contextValues);
      if (!lost && method.localName === "createVerificationToken") {
        lost = true;
        throw new ConnectError("compatibility response lost after commit", Code.DeadlineExceeded);
      }
      return response;
    },
    stream: (method, signal, timeoutMs, header, input, contextValues) =>
      transport.stream(method, signal, timeoutMs, header, input, contextValues),
  };
}

describe("Admin Auth compatibility digest attestation", () => {
  it("rejects a Root/Web generated-contract skew before making a request", () => {
    expect(() => assertContractDigest("0".repeat(64))).toThrow("admin_auth_contract_digest_mismatch");
  });
});

describe("Admin Auth live generated-client compatibility", () => {
  it("attests the generated digest and resolves the seeded operator", async () => {
    const config = liveConfig();
    expect(config.contractDigest).toBe(contractMetadata.artifactDigestSha256);
    const client = createAdminAuthClient({
      transport: createAdminAuthTransport({
        gatewayUrl: config.gatewayUrl,
        proxySecret: config.proxySecret,
        environment: "test",
      }),
    });

    await expect(client.findOperatorByEmail(" Admin@Kokoro.Local ")).resolves.toMatchObject({
      id: "op-superadmin",
      email: "admin@kokoro.local",
      status: "active",
    });
  });

  it("rejects missing credentials, the wrong audience, and invalid input with typed safe errors", async () => {
    const config = liveConfig();
    const missingCredential = createClient(
      AdminAuthService,
      rawTransport(config.gatewayUrl, [metadataInterceptor({ audience: "admin-web" })]),
    );
    const wrongAudience = createClient(
      AdminAuthService,
      rawTransport(config.gatewayUrl, [
        metadataInterceptor({ audience: "other", proxySecret: config.proxySecret }),
      ]),
    );
    const valid = createClient(
      AdminAuthService,
      rawTransport(config.gatewayUrl, [
        metadataInterceptor({ audience: "admin-web", proxySecret: config.proxySecret }),
      ]),
    );

    expect((await connectFailure(missingCredential.getOperator({ id: "op-superadmin" }))).code).toBe(
      Code.Unauthenticated,
    );
    expect((await connectFailure(wrongAudience.getOperator({ id: "op-superadmin" }))).code).toBe(
      Code.PermissionDenied,
    );
    const invalid = await connectFailure(valid.getOperatorByEmail({ email: "pi" }));
    expect(invalid.code).toBe(Code.InvalidArgument);
    expect(invalid.findDetails(KokoroErrorDetailSchema)).toMatchObject([
      { domainCode: "request.invalid", safeMessage: "Invalid request" },
    ]);
    expect(invalid.rawMessage).not.toContain("pi");
  });

  it("verifies payload digests and replays one consume effect for the same command identity", async () => {
    const config = liveConfig();
    const transport = createAdminAuthTransport({
      gatewayUrl: config.gatewayUrl,
      proxySecret: config.proxySecret,
      environment: "test",
    });
    const expires = new Date(Date.now() + 10 * 60_000);
    const identifier = "admin@kokoro.local";
    const token = `compat-token-${randomUUID()}`;
    const createClientPort = createAdminAuthClient({
      transport,
      newCommandId: () => `compat-create-${randomUUID()}`,
    });
    const created = await createClientPort.createVerificationToken({ identifier, token, expires });
    expect(created.identifier).toBe(identifier);
    expect(created.expires).toEqual(expires);
    expect(created.token === token).toBe(true);

    const consumeCommandId = `compat-consume-${randomUUID()}`;
    const consumeClient = createAdminAuthClient({ transport, newCommandId: () => consumeCommandId });
    const first = await consumeClient.consumeVerificationToken({ identifier, token });
    const replay = await consumeClient.consumeVerificationToken({ identifier, token });
    expect(first?.identifier).toBe(identifier);
    expect(first?.expires).toEqual(expires);
    expect(first?.token === token).toBe(true);
    expect(replay?.identifier).toBe(identifier);
    expect(replay?.expires).toEqual(expires);
    expect(replay?.token === token).toBe(true);

    const mismatchClient = createAdminAuthClient({ transport, newCommandId: () => consumeCommandId });
    const mismatch = await clientFailure(
      mismatchClient.consumeVerificationToken({ identifier, token: `${token}-different` }),
    );
    expect(mismatch).toMatchObject({
      connectCode: Code.FailedPrecondition,
      domainCode: "command.digest_conflict",
    });
    expect(String(mismatch)).not.toContain(token);

    const invalidDigestClient = createClient(AdminAuthService, transport);
    const invalidDigestToken = `compat-invalid-${randomUUID()}`;
    const invalidDigest = await connectFailure(
      invalidDigestClient.createVerificationToken({
        command: {
          commandId: `compat-invalid-${randomUUID()}`,
          idempotencyKey: `compat-invalid-${randomUUID()}`,
          digestAlgorithm: ADMIN_AUTH_COMMAND_DIGEST_ALGORITHM,
          requestDigest: "0".repeat(64),
        },
        effect: {
          identifier,
          token: invalidDigestToken,
          expires: timestampFromDate(expires),
        },
      }),
    );
    expect(invalidDigest.code).toBe(Code.InvalidArgument);
    expect(invalidDigest.findDetails(KokoroErrorDetailSchema)).toMatchObject([
      { domainCode: "command.digest_invalid" },
    ]);
    expect(String(invalidDigest)).not.toContain(invalidDigestToken);
  });

  it("recovers a committed effect after its real HTTP response is lost", async () => {
    const config = liveConfig();
    const baseTransport = createAdminAuthTransport({
      gatewayUrl: config.gatewayUrl,
      proxySecret: config.proxySecret,
      environment: "test",
    });
    const commandId = `compat-reconcile-${randomUUID()}`;
    const token = `compat-reconcile-token-${randomUUID()}`;
    const expires = new Date(Date.now() + 10 * 60_000);
    const client = createAdminAuthClient({
      transport: loseFirstCreateResponse(baseTransport),
      newCommandId: () => commandId,
    });

    const reconciled = await client.createVerificationToken({
      identifier: "admin@kokoro.local",
      token,
      expires,
    });
    expect(reconciled.identifier).toBe("admin@kokoro.local");
    expect(reconciled.expires).toEqual(expires);
    expect(reconciled.token === token).toBe(true);
  });
});

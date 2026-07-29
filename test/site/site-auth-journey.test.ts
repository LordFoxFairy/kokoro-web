import { describe, expect, it } from "vitest";

import {
  createPlatformPublicClient,
  PlatformPublicInputError,
  PlatformPublicProtocolError,
  type PlatformPublicOperationId,
  type PlatformPublicRequest,
  type PlatformPublicTransport,
} from "../../packages/site-client/src/server.js";

class IsolatedSiteTransport implements PlatformPublicTransport {
  readonly users = new Set<string>();
  sessionRef: string | undefined;

  constructor(readonly siteKey: string) {}

  async execute<Operation extends PlatformPublicOperationId>(
    request: PlatformPublicRequest<Operation>,
  ) {
    const body = request.body as Record<string, string>;
    const receipt = {
      commandId: request.headers["X-Kokoro-Command-Id"],
      requestDigest: "a".repeat(64),
      receiptRef: `${this.siteKey}-receipt`,
      state: "committed",
      committedAt: "2026-07-28T00:00:00Z",
    };
    if (request.operationId === "beginRegistration") {
      this.users.add(body.email);
      return { ok: true, status: 200, body: {
        receipt,
        transaction: {
          transactionRef: `${this.siteKey}-verify`,
          expiresAt: "2026-07-28T00:05:00Z",
          deliveryState: "sent",
        },
      } };
    }
    if (request.operationId === "completeEmailVerification") {
      return { ok: true, status: 200, body: { receipt, accountRef: `${this.siteKey}-account` } };
    }
    if (request.operationId === "createIdentitySession") {
      if (!this.users.has(body.email)) throw new Error("site-local account not found");
      return { ok: true, status: 200, body: {
        receipt,
        pending: {
          transactionRef: `${this.siteKey}-mfa`,
          challengeKind: "totp",
          expiresAt: "2026-07-28T00:05:00Z",
        },
      } };
    }
    if (request.operationId === "completeSessionMfa") {
      this.sessionRef = `${this.siteKey}-session`;
      return { ok: true, status: 200, body: {
        commandId: request.headers["X-Kokoro-Command-Id"],
        requestDigest: "a".repeat(64),
        credentials: {
          sessionCredential: "s".repeat(32),
          sessionCredentialExpiresAt: "2026-07-28T01:00:00Z",
          refreshCredential: "r".repeat(32),
          refreshCredentialExpiresAt: "2026-08-28T00:00:00Z",
          sessionRef: this.sessionRef,
        },
      } };
    }
    if (request.operationId === "revokeIdentitySessions") {
      if (this.sessionRef === undefined) throw new Error("site-local session required");
      this.sessionRef = undefined;
      return { ok: true, status: 200, body: { receipt } };
    }
    throw new Error("unsupported operation");
  }
}

class UnexpectedResponseTransport implements PlatformPublicTransport {
  calls = 0;

  async execute<Operation extends PlatformPublicOperationId>(
    _request: PlatformPublicRequest<Operation>,
  ) {
    this.calls += 1;
    return { status: 201, body: { unexpected: true } };
  }
}

describe("generated-contract Site auth orchestration", () => {
  it("rejects malformed generated request bodies before transport", async () => {
    const transport = new UnexpectedResponseTransport();
    const client = createPlatformPublicClient({
      transport,
      csrfToken: () => "a".repeat(32),
      randomBytes: (length) => new Uint8Array(length).fill(7),
    });

    await expect(client.execute({
      operationId: "beginRegistration",
      data: { body: { email: "person@example.com", password: "short", legalAcceptanceRefs: [] } },
      command: client.createCommand(),
    })).rejects.toBeInstanceOf(PlatformPublicInputError);
    expect(transport.calls).toBe(0);
  });

  it("wraps undeclared statuses with malformed error bodies as a stable protocol error", async () => {
    const transport = new UnexpectedResponseTransport();
    const client = createPlatformPublicClient({
      transport,
      csrfToken: () => "a".repeat(32),
      randomBytes: (length) => new Uint8Array(length).fill(7),
    });

    await expect(client.execute({
      operationId: "beginRegistration",
      data: {
        body: {
          email: "person@example.com",
          password: "long-password-value",
          legalAcceptanceRefs: ["terms.v1"],
        },
      },
      command: client.createCommand(),
    })).rejects.toMatchObject({
      name: "PlatformPublicProtocolError",
      code: "PLATFORM_PUBLIC_PROTOCOL_ERROR",
      phase: "error_response",
      status: 201,
    } satisfies Partial<PlatformPublicProtocolError>);
    expect(transport.calls).toBe(1);
  });

  it("keeps registration, verification, explicit login, MFA and revoke Site-local", async () => {
    const alphaTransport = new IsolatedSiteTransport("alpha");
    const betaTransport = new IsolatedSiteTransport("beta");
    const randomBytes = (length: number) => new Uint8Array(length).fill(7);
    const alpha = createPlatformPublicClient({ transport: alphaTransport, csrfToken: () => "a".repeat(32), randomBytes });
    const beta = createPlatformPublicClient({ transport: betaTransport, csrfToken: () => "b".repeat(32), randomBytes });

    const email = "same-address@example.com";
    const registration = await alpha.execute({
      operationId: "beginRegistration",
      data: { body: { email, password: "long-password-value", legalAcceptanceRefs: ["terms.v1"] } },
      command: alpha.createCommand(),
    });
    await alpha.execute({
      operationId: "completeEmailVerification",
      data: {
        path: { id: registration.transaction.transactionRef },
        body: { transactionSecret: "v".repeat(32) },
      },
      command: alpha.createSecretCommand(),
    });
    const pending = await alpha.execute({
      operationId: "createIdentitySession",
      data: { body: { email, password: "long-password-value" } },
      command: alpha.createSecretCommand(),
    });
    const session = await alpha.execute({
      operationId: "completeSessionMfa",
      data: { path: { id: pending.pending.transactionRef }, body: { code: "123456" } },
      command: alpha.createSecretCommand(),
    });
    expect(session.credentials.sessionRef).toBe("alpha-session");
    await expect(
      beta.execute({
        operationId: "createIdentitySession",
        data: { body: { email, password: "long-password-value" } },
        command: beta.createSecretCommand(),
      }),
    ).rejects.toThrow("site-local account not found");
    await alpha.execute({
      operationId: "revokeIdentitySessions",
      data: { body: { target: "current" } },
      command: alpha.createCommand(),
    });
    expect(alphaTransport.sessionRef).toBeUndefined();
    expect(betaTransport.sessionRef).toBeUndefined();
  });
});

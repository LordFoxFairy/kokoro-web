import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import type { AdapterAccount, VerificationToken } from "next-auth/adapters";
import { describe, expect, it } from "vitest";

import { IamAuthAdapterService } from "../../generated/iam/proto/kokoro/iam/v1/auth_adapter_pb";
import {
  AccountRecordSchema,
  SessionRecordSchema,
  UserRecordSchema,
  VerificationTokenRecordSchema,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createIamAuthAdapter } from "../../server/auth/adapter";
import { createIamAuthAdapterClient } from "../../server/iam/auth-adapter-client";

const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const accountId = "ed843990-f453-49e1-a9d1-07de7da2dc4d";
const sessionId = "28c78b8d-f655-46b4-ac79-c7bc5755013a";
const createdAt = new Date("2026-08-15T20:00:00.000Z");
const updatedAt = new Date("2026-08-15T20:05:00.000Z");
const expires = new Date("2026-08-16T04:00:00.000Z");
const sessionToken = "session-token-with-at-least-thirty-two-bytes";
const verificationToken = "verification-token-with-enough-bytes";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function userRecord(overrides: Readonly<{ email?: string }> = {}) {
  return create(UserRecordSchema, {
    id: userId,
    email: overrides.email ?? "admin@example.com",
    name: "Admin",
    emailVerified: timestampFromDate(createdAt),
    platformRole: "admin",
    status: "active",
    version: BigInt(7),
    createdAt: timestampFromDate(createdAt),
    updatedAt: timestampFromDate(updatedAt),
  });
}

function adapterFixture() {
  const calls: Array<Readonly<{ method: string; request: unknown }>> = [];
  const transport = createRouterTransport((router) => {
    router.service(IamAuthAdapterService, {
      createUser(request) {
        calls.push({ method: "createUser", request });
        if (request.email === "unknown@example.com") {
          throw new ConnectError("registration is disabled", Code.PermissionDenied);
        }
        return { user: userRecord({ email: request.email }) };
      },
      getUser(request) {
        calls.push({ method: "getUser", request });
        return { user: request.userId === userId ? userRecord() : undefined };
      },
      getUserByEmail(request) {
        calls.push({ method: "getUserByEmail", request });
        return { user: request.email === "missing@example.com" ? undefined : userRecord({ email: request.email }) };
      },
      getUserByAccount(request) {
        calls.push({ method: "getUserByAccount", request });
        return { user: request.providerAccountId === "missing" ? undefined : userRecord() };
      },
      updateUser(request) {
        calls.push({ method: "updateUser", request });
        return { user: userRecord({ email: request.email }) };
      },
      deleteUser(request) {
        calls.push({ method: "deleteUser", request });
        return { deleted: false };
      },
      linkAccount(request) {
        calls.push({ method: "linkAccount", request });
        if (request.account === undefined) throw new ConnectError("missing account", Code.Internal);
        return {
          account: create(AccountRecordSchema, {
            ...request.account,
            id: accountId,
            status: "linked",
          }),
        };
      },
      unlinkAccount(request) {
        calls.push({ method: "unlinkAccount", request });
        return { unlinked: false };
      },
      createSession(request) {
        calls.push({ method: "createSession", request });
        if (request.session === undefined) throw new ConnectError("missing session", Code.Internal);
        return {
          session: create(SessionRecordSchema, {
            ...request.session,
            id: sessionId,
            createdAt: timestampFromDate(createdAt),
            updatedAt: timestampFromDate(updatedAt),
          }),
        };
      },
      getSessionAndUser(request) {
        calls.push({ method: "getSessionAndUser", request });
        if (request.sessionToken.startsWith("missing")) return {};
        if (request.sessionToken.startsWith("partial")) return { session: sessionRecord() };
        return { session: sessionRecord(), user: userRecord() };
      },
      updateSession(request) {
        calls.push({ method: "updateSession", request });
        return request.sessionToken.startsWith("missing") ? {} : { session: sessionRecord() };
      },
      deleteSession(request) {
        calls.push({ method: "deleteSession", request });
        return { deleted: false };
      },
      createVerificationToken(request) {
        calls.push({ method: "createVerificationToken", request });
        return { verificationToken: request.verificationToken };
      },
      useVerificationToken(request) {
        calls.push({ method: "useVerificationToken", request });
        return request.identifier === "missing@example.com"
          ? {}
          : {
              verificationToken: create(VerificationTokenRecordSchema, {
                identifier: request.identifier,
                token: request.token,
                expires: timestampFromDate(expires),
              }),
            };
      },
    });
  });
  return { adapter: createIamAuthAdapter(createIamAuthAdapterClient(transport)), calls };
}

function sessionRecord() {
  return create(SessionRecordSchema, {
    id: sessionId,
    sessionToken,
    userId,
    expires: timestampFromDate(expires),
    createdAt: timestampFromDate(createdAt),
    updatedAt: timestampFromDate(updatedAt),
  });
}

function requiredMethod<T extends (...args: never[]) => unknown>(method: T | undefined, name: string): T {
  if (method === undefined) throw new Error(`Adapter method ${name} is missing`);
  return method;
}

describe("complete Auth.js IAM Adapter", () => {
  it("WEB-UNIT-ADAPTER-001 exposes exactly the fourteen accepted Adapter methods", () => {
    const { adapter } = adapterFixture();

    expect(Object.keys(adapter).sort()).toEqual([
      "createSession",
      "createUser",
      "createVerificationToken",
      "deleteSession",
      "deleteUser",
      "getSessionAndUser",
      "getUser",
      "getUserByAccount",
      "getUserByEmail",
      "linkAccount",
      "unlinkAccount",
      "updateSession",
      "updateUser",
      "useVerificationToken",
    ]);
  });

  it("WEB-UNIT-ADAPTER-001 maps create/read/update/delete User calls and preserves registration denial", async () => {
    const { adapter, calls } = adapterFixture();
    const createUser = requiredMethod(adapter.createUser, "createUser");
    const getUser = requiredMethod(adapter.getUser, "getUser");
    const getUserByEmail = requiredMethod(adapter.getUserByEmail, "getUserByEmail");
    const getUserByAccount = requiredMethod(adapter.getUserByAccount, "getUserByAccount");
    const updateUser = requiredMethod(adapter.updateUser, "updateUser");
    const deleteUser = requiredMethod(adapter.deleteUser, "deleteUser");
    const input = {
      id: userId,
      email: "admin@example.com",
      name: "Admin",
      image: null,
      emailVerified: createdAt,
      platformRole: "admin" as const,
      status: "active" as const,
    };

    expect(await createUser(input)).toMatchObject(input);
    await expect(createUser({ ...input, email: "unknown@example.com" })).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
    expect(await getUser(userId)).toMatchObject(input);
    expect(await getUser("94944258-f6a2-4813-bd2e-3e4a38053021")).toBeNull();
    expect(await getUserByEmail("submitted@example.com")).toMatchObject({ email: "submitted@example.com" });
    expect(await getUserByEmail("missing@example.com")).toBeNull();
    expect(await getUserByAccount({ provider: "nodemailer", providerAccountId: "admin@example.com" }))
      .toMatchObject({ id: userId });
    expect(await getUserByAccount({ provider: "nodemailer", providerAccountId: "missing" })).toBeNull();
    expect(await updateUser({ id: userId, email: "updated@example.com", emailVerified: updatedAt }))
      .toMatchObject({ email: "updated@example.com", emailVerified: createdAt });
    await expect(deleteUser(userId)).resolves.toBeUndefined();

    const update = calls.findLast((call) => call.method === "updateUser")?.request as {
      requestId: string; email?: string; emailVerified?: unknown;
    };
    const deletion = calls.findLast((call) => call.method === "deleteUser")?.request as {
      command?: { requestId: string; commandId: string; reason: string }; userId: string;
    };
    expect(update.requestId).toMatch(uuid);
    expect(update.email).toBe("updated@example.com");
    expect(update.emailVerified).toBeDefined();
    expect(deletion).toMatchObject({ userId, command: { reason: "Auth.js Adapter deleteUser" } });
    expect(deletion.command?.requestId).toMatch(uuid);
    expect(deletion.command?.commandId).toMatch(uuid);
  });

  it("WEB-UNIT-ADAPTER-001 maps complete Account fields and rejects unsafe int64 expiry", async () => {
    const { adapter } = adapterFixture();
    const linkAccount = requiredMethod(adapter.linkAccount, "linkAccount");
    const unlinkAccount = requiredMethod(adapter.unlinkAccount, "unlinkAccount");
    const account: AdapterAccount = {
      userId,
      type: "oidc",
      provider: "provider",
      providerAccountId: "provider-account",
      refresh_token: "refresh",
      access_token: "access",
      expires_at: 2_000_000_000,
      token_type: "bearer",
      scope: "openid email",
      id_token: "id-token",
      session_state: "session-state",
    };

    expect(await linkAccount(account)).toEqual(account);
    await expect(unlinkAccount({ provider: account.provider, providerAccountId: account.providerAccountId }))
      .resolves.toBeUndefined();

    const unsafeTransport = createRouterTransport((router) => {
      router.service(IamAuthAdapterService, {
        linkAccount: (request) => ({
          account: create(AccountRecordSchema, {
            id: accountId,
            userId: request.account?.userId,
            type: request.account?.type,
            provider: request.account?.provider,
            providerAccountId: request.account?.providerAccountId,
            refreshToken: request.account?.refreshToken,
            accessToken: request.account?.accessToken,
            status: "linked",
            expiresAt: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
            tokenType: request.account?.tokenType,
            scope: request.account?.scope,
            idToken: request.account?.idToken,
            sessionState: request.account?.sessionState,
          }),
        }),
      });
    });
    const unsafe = createIamAuthAdapter(createIamAuthAdapterClient(unsafeTransport));
    await expect(requiredMethod(unsafe.linkAccount, "linkAccount")(account))
      .rejects.toThrow("invalid IAM AccountRecord");
  });

  it("WEB-UNIT-ADAPTER-001 maps database Session lifecycle and rejects partial joined responses", async () => {
    const { adapter } = adapterFixture();
    const createSession = requiredMethod(adapter.createSession, "createSession");
    const getSessionAndUser = requiredMethod(adapter.getSessionAndUser, "getSessionAndUser");
    const updateSession = requiredMethod(adapter.updateSession, "updateSession");
    const deleteSession = requiredMethod(adapter.deleteSession, "deleteSession");

    expect(await createSession({ sessionToken, userId, expires })).toEqual({ sessionToken, userId, expires });
    expect(await getSessionAndUser(sessionToken)).toEqual({
      session: { sessionToken, userId, expires },
      user: {
        id: userId,
        email: "admin@example.com",
        name: "Admin",
        image: null,
        emailVerified: createdAt,
        platformRole: "admin",
        status: "active",
      },
    });
    expect(await getSessionAndUser(`missing-${"x".repeat(32)}`)).toBeNull();
    await expect(getSessionAndUser(`partial-${"x".repeat(32)}`))
      .rejects.toThrow("invalid IAM GetSessionAndUserResponse");
    expect(await updateSession({ sessionToken, expires: updatedAt })).toEqual({ sessionToken, userId, expires });
    expect(await updateSession({ sessionToken: `missing-${"x".repeat(32)}`, expires: updatedAt })).toBeNull();
    await expect(deleteSession(sessionToken)).resolves.toBeUndefined();
  });

  it("WEB-UNIT-ADAPTER-001 maps one-time VerificationToken lifecycle with null optional results", async () => {
    const { adapter } = adapterFixture();
    const createVerificationToken = requiredMethod(adapter.createVerificationToken, "createVerificationToken");
    const useVerificationToken = requiredMethod(adapter.useVerificationToken, "useVerificationToken");
    const token: VerificationToken = {
      identifier: "admin@example.com",
      token: verificationToken,
      expires,
    };

    expect(await createVerificationToken(token)).toEqual(token);
    expect(await useVerificationToken({ identifier: token.identifier, token: token.token })).toEqual(token);
    expect(await useVerificationToken({ identifier: "missing@example.com", token: token.token })).toBeNull();
  });
});

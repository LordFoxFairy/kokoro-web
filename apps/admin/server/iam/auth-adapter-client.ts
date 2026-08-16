import "server-only";

import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient, type Transport } from "@connectrpc/connect";
import type {
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from "next-auth/adapters";

import { IamAuthAdapterService } from "../../generated/iam/proto/kokoro/iam/v1/auth_adapter_pb";
import {
  AccountRecordSchema,
  SessionRecordSchema,
  VerificationTokenRecordSchema,
  type AccountRecord,
  type SessionRecord,
  type VerificationTokenRecord,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { userFromRecord } from "./records";

export interface IamAuthAdapterClient {
  createUser(value: AdapterUser): Promise<AdapterUser>;
  getUser(id: string): Promise<AdapterUser | null>;
  getUserByEmail(email: string): Promise<AdapterUser | null>;
  getUserByAccount(key: Pick<AdapterAccount, "provider" | "providerAccountId">): Promise<AdapterUser | null>;
  updateUser(value: Partial<AdapterUser> & Pick<AdapterUser, "id">): Promise<AdapterUser>;
  deleteUser(id: string): Promise<void>;
  linkAccount(value: AdapterAccount): Promise<AdapterAccount | null>;
  unlinkAccount(key: Pick<AdapterAccount, "provider" | "providerAccountId">): Promise<void>;
  createSession(value: AdapterSession): Promise<AdapterSession>;
  getSessionAndUser(token: string): Promise<{ session: AdapterSession; user: AdapterUser } | null>;
  updateSession(value: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">): Promise<AdapterSession | null>;
  deleteSession(token: string): Promise<void>;
  createVerificationToken(value: VerificationToken): Promise<VerificationToken>;
  useVerificationToken(key: Pick<VerificationToken, "identifier" | "token">): Promise<VerificationToken | null>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const tokenPattern = /^[A-Za-z0-9._~-]{16,1024}$/u;
const accountTypes = new Set(["oauth", "oidc", "email", "webauthn"]);

function invalid(name: string): never {
  throw new Error(`invalid IAM ${name}`);
}

function required<T>(value: T | undefined, name: string): T {
  return value ?? invalid(name);
}

function validDate(value: Date, name: string): Date {
  if (!Number.isFinite(value.getTime())) return invalid(name);
  return value;
}

function date(value: Parameters<typeof timestampDate>[0] | undefined, name: string): Date {
  if (value === undefined) return invalid(name);
  try {
    return validDate(timestampDate(value), name);
  } catch {
    return invalid(name);
  }
}

function user(record: Parameters<typeof userFromRecord>[0]): AdapterUser {
  const value = userFromRecord(record);
  return Object.freeze({
    id: value.id,
    email: value.email,
    name: value.name,
    image: value.image,
    emailVerified: value.emailVerified,
    platformRole: value.platformRole,
    status: value.status,
  });
}

function safeExpiresAt(value: number | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) return invalid("AdapterAccount.expires_at");
  return BigInt(value);
}

function accountInput(value: AdapterAccount): AccountRecord {
  return create(AccountRecordSchema, {
    userId: value.userId,
    type: value.type,
    provider: value.provider,
    providerAccountId: value.providerAccountId,
    refreshToken: value.refresh_token,
    accessToken: value.access_token,
    expiresAt: safeExpiresAt(value.expires_at),
    tokenType: value.token_type,
    scope: value.scope,
    idToken: value.id_token,
    sessionState: typeof value.session_state === "string" ? value.session_state : undefined,
  });
}

function account(record: AccountRecord | undefined): AdapterAccount {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.userId)
    || !accountTypes.has(record.type)
    || record.provider.length < 1
    || record.providerAccountId.length < 1
    || record.status !== "linked"
    || (record.tokenType !== undefined && record.tokenType !== record.tokenType.toLowerCase())
    || (record.expiresAt !== undefined
      && (record.expiresAt > BigInt(Number.MAX_SAFE_INTEGER)
        || record.expiresAt < BigInt(Number.MIN_SAFE_INTEGER)))
  ) {
    return invalid("AccountRecord");
  }
  return Object.freeze({
    userId: record.userId,
    type: record.type as AdapterAccount["type"],
    provider: record.provider,
    providerAccountId: record.providerAccountId,
    ...(record.refreshToken === undefined ? {} : { refresh_token: record.refreshToken }),
    ...(record.accessToken === undefined ? {} : { access_token: record.accessToken }),
    ...(record.expiresAt === undefined ? {} : { expires_at: Number(record.expiresAt) }),
    ...(record.tokenType === undefined
      ? {}
      : { token_type: record.tokenType as AdapterAccount["token_type"] }),
    ...(record.scope === undefined ? {} : { scope: record.scope }),
    ...(record.idToken === undefined ? {} : { id_token: record.idToken }),
    ...(record.sessionState === undefined ? {} : { session_state: record.sessionState }),
  });
}

function sessionInput(value: AdapterSession): SessionRecord {
  return create(SessionRecordSchema, {
    sessionToken: value.sessionToken,
    userId: value.userId,
    expires: timestampFromDate(validDate(value.expires, "AdapterSession.expires")),
  });
}

function session(record: SessionRecord | undefined): AdapterSession {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.userId)
    || !tokenPattern.test(record.sessionToken)
  ) {
    return invalid("SessionRecord");
  }
  return Object.freeze({
    sessionToken: record.sessionToken,
    userId: record.userId,
    expires: date(record.expires, "SessionRecord"),
  });
}

function verificationInput(value: VerificationToken): VerificationTokenRecord {
  return create(VerificationTokenRecordSchema, {
    identifier: value.identifier,
    token: value.token,
    expires: timestampFromDate(validDate(value.expires, "VerificationToken.expires")),
  });
}

function verification(record: VerificationTokenRecord | undefined): VerificationToken {
  if (
    record === undefined
    || record.identifier.length < 1
    || !tokenPattern.test(record.token)
  ) {
    return invalid("VerificationTokenRecord");
  }
  return Object.freeze({
    identifier: record.identifier,
    token: record.token,
    expires: date(record.expires, "VerificationTokenRecord"),
  });
}

export function createIamAuthAdapterClient(transport: Transport): IamAuthAdapterClient {
  const rpc = createClient(IamAuthAdapterService, transport);
  const client: IamAuthAdapterClient = {
    async createUser(value) {
      const response = await rpc.createUser({
        requestId: randomUUID(),
        email: value.email,
        name: value.name?.trim() || value.email,
        image: value.image ?? undefined,
      });
      return user(required(response.user, "CreateUserResponse"));
    },
    async getUser(id) {
      const response = await rpc.getUser({ requestId: randomUUID(), userId: id });
      return response.user === undefined ? null : user(response.user);
    },
    async getUserByEmail(email) {
      const response = await rpc.getUserByEmail({ requestId: randomUUID(), email });
      return response.user === undefined ? null : user(response.user);
    },
    async getUserByAccount(key) {
      const response = await rpc.getUserByAccount({ requestId: randomUUID(), ...key });
      return response.user === undefined ? null : user(response.user);
    },
    async updateUser(value) {
      const response = await rpc.updateUser({
        requestId: randomUUID(),
        userId: value.id,
        email: value.email ?? undefined,
        name: value.name ?? undefined,
        image: value.image ?? undefined,
        emailVerified: value.emailVerified === null || value.emailVerified === undefined
          ? undefined
          : timestampFromDate(validDate(value.emailVerified, "AdapterUser.emailVerified")),
      });
      return user(required(response.user, "UpdateUserResponse"));
    },
    async deleteUser(id) {
      await rpc.deleteUser({
        command: {
          requestId: randomUUID(),
          commandId: randomUUID(),
          reason: "Auth.js Adapter deleteUser",
        },
        userId: id,
      });
    },
    async linkAccount(value) {
      const response = await rpc.linkAccount({ requestId: randomUUID(), account: accountInput(value) });
      return account(required(response.account, "LinkAccountResponse"));
    },
    async unlinkAccount(key) {
      await rpc.unlinkAccount({ requestId: randomUUID(), ...key });
    },
    async createSession(value) {
      const response = await rpc.createSession({ requestId: randomUUID(), session: sessionInput(value) });
      return session(required(response.session, "CreateSessionResponse"));
    },
    async getSessionAndUser(token) {
      const response = await rpc.getSessionAndUser({ requestId: randomUUID(), sessionToken: token });
      if (response.session === undefined && response.user === undefined) return null;
      if (response.session === undefined || response.user === undefined) return invalid("GetSessionAndUserResponse");
      const mappedSession = session(response.session);
      const mappedUser = user(response.user);
      if (mappedSession.userId !== mappedUser.id) return invalid("GetSessionAndUserResponse");
      return Object.freeze({ session: mappedSession, user: mappedUser });
    },
    async updateSession(value) {
      const response = await rpc.updateSession({
        requestId: randomUUID(),
        sessionToken: value.sessionToken,
        expires: value.expires === undefined
          ? undefined
          : timestampFromDate(validDate(value.expires, "AdapterSession.expires")),
      });
      return response.session === undefined ? null : session(response.session);
    },
    async deleteSession(token) {
      await rpc.deleteSession({ requestId: randomUUID(), sessionToken: token });
    },
    async createVerificationToken(value) {
      const response = await rpc.createVerificationToken({
        requestId: randomUUID(),
        verificationToken: verificationInput(value),
      });
      return verification(required(response.verificationToken, "CreateVerificationTokenResponse"));
    },
    async useVerificationToken(key) {
      const response = await rpc.useVerificationToken({ requestId: randomUUID(), ...key });
      return response.verificationToken === undefined ? null : verification(response.verificationToken);
    },
  };
  return Object.freeze(client);
}

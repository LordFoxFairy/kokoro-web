import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";

import { IamAuthAdapterService } from "../../generated/iam/proto/kokoro/iam/v1/auth_adapter_pb";
import {
  SessionRecordSchema,
  UserRecordSchema,
  type SessionRecord,
  type VerificationTokenRecord,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createAdminAuthOptions } from "../../server/auth/options";
import { createTrustedAuthHandlers } from "../../server/auth/route";
import type { AdminRuntimeConfig } from "../../server/config/config";
import { createIamAuthAdapterClient } from "../../server/iam/auth-adapter-client";

const createdAt = new Date("2026-08-15T20:00:00.000Z");
const baseUrl = "http://localhost:3100";

type CookieJar = Map<string, string>;

type Identity = Readonly<{
  platformRole: "user" | "admin";
  status: "active" | "suspended" | "deleted";
}>;

const identities = new Map<string, Identity>([
  ["active@example.com", { platformRole: "admin", status: "active" }],
  ["user00@example.com", { platformRole: "user", status: "active" }],
  ["suspend@example.com", { platformRole: "admin", status: "suspended" }],
  ["deleted@example.com", { platformRole: "admin", status: "deleted" }],
] as const);

export type MagicLinkRequest = Readonly<{
  cookies: CookieJar;
  link: string;
  frameworkResult: Readonly<{ status: number; location: string; body: string }>;
  publicResult: Readonly<{ status: number; location: string; body: string }>;
}>;

export type AuthRouteFixture = Readonly<{
  requestMagicLink(email: string, callbackUrl?: string): Promise<MagicLinkRequest>;
  consumeLink(link: string, cookies: CookieJar): Promise<Response>;
  getPublicSession(cookies: CookieJar): Promise<unknown>;
  signOut(cookies: CookieJar): Promise<Response>;
  sessionCount(): number;
}>;

export function createAuthRouteFixture(): AuthRouteFixture {
  const verificationTokens = new Map<string, VerificationTokenRecord>();
  const sessions = new Map<string, SessionRecord>();
  const links = new Map<string, string>();
  const transport = createRouterTransport((router) => {
    router.service(IamAuthAdapterService, {
      createUser() {
        throw new ConnectError("registration is disabled", Code.PermissionDenied);
      },
      getUser(request) {
        const entry = [...identities].find(([, value]) => identityId(value.platformRole, value.status) === request.userId);
        return { user: entry === undefined ? undefined : userRecord(entry[0], entry[1]) };
      },
      getUserByEmail(request) {
        const identity = identities.get(request.email);
        return { user: identity === undefined ? undefined : userRecord(request.email, identity) };
      },
      getUserByAccount() {
        return {};
      },
      updateUser(request) {
        const entry = [...identities].find(([, value]) => identityId(value.platformRole, value.status) === request.userId);
        if (entry === undefined) throw new ConnectError("missing", Code.NotFound);
        return { user: userRecord(entry[0], entry[1], request.emailVerified) };
      },
      linkAccount(request) {
        return { account: request.account };
      },
      createSession(request) {
        if (request.session === undefined) throw new ConnectError("missing session", Code.Internal);
        const stored = create(SessionRecordSchema, {
          ...request.session,
          id: randomUUID(),
          createdAt: timestampFromDate(createdAt),
          updatedAt: timestampFromDate(createdAt),
        });
        sessions.set(stored.sessionToken, stored);
        return { session: stored };
      },
      getSessionAndUser(request) {
        const session = sessions.get(request.sessionToken);
        if (session === undefined) return {};
        const entry = [...identities].find(([, value]) => identityId(value.platformRole, value.status) === session.userId);
        if (entry === undefined || entry[1].platformRole !== "admin" || entry[1].status !== "active") return {};
        return { session, user: userRecord(entry[0], entry[1]) };
      },
      updateSession(request) {
        const current = sessions.get(request.sessionToken);
        if (current === undefined) return {};
        const updated = create(SessionRecordSchema, {
          ...current,
          expires: request.expires ?? current.expires,
          updatedAt: timestampFromDate(createdAt),
        });
        sessions.set(updated.sessionToken, updated);
        return { session: updated };
      },
      deleteSession(request) {
        return { deleted: sessions.delete(request.sessionToken) };
      },
      createVerificationToken(request) {
        if (request.verificationToken === undefined) {
          throw new ConnectError("missing verification token", Code.Internal);
        }
        const key = verificationKey(request.verificationToken.identifier, request.verificationToken.token);
        verificationTokens.set(key, request.verificationToken);
        return { verificationToken: request.verificationToken };
      },
      useVerificationToken(request) {
        const key = verificationKey(request.identifier, request.token);
        const token = verificationTokens.get(key);
        verificationTokens.delete(key);
        return { verificationToken: token };
      },
    });
  });
  const options = createAdminAuthOptions(runtimeConfig(), {
    authAdapterClient: createIamAuthAdapterClient(transport),
    logger: { error() {}, warn() {}, debug() {} },
    async sendVerificationRequest(params) {
      links.set(params.identifier, params.url);
    },
  });
  const runtime = NextAuth(options);
  const handlers = createTrustedAuthHandlers(runtime.handlers, baseUrl);

  async function requestMagicLink(email: string, callbackUrl = "/"): Promise<MagicLinkRequest> {
    const cookies: CookieJar = new Map();
    const csrf = await handlers.GET(request("/api/auth/csrf", "GET", cookies));
    updateCookies(cookies, csrf);
    const csrfBody = await csrf.json() as { csrfToken?: unknown };
    if (typeof csrfBody.csrfToken !== "string") throw new Error("Auth.js fixture did not return CSRF token");
    const body = new URLSearchParams({ csrfToken: csrfBody.csrfToken, email, callbackUrl });
    const response = await handlers.POST(request("/api/auth/signin/nodemailer", "POST", cookies, body));
    updateCookies(cookies, response);
    const link = links.get(email);
    if (link === undefined) throw new Error("Auth.js fixture did not send a verification link");
    const frameworkResult = {
      status: response.status,
      location: response.headers.get("location") ?? "",
      body: await response.text(),
    };
    const verifyRequest = await handlers.GET(new NextRequest(frameworkResult.location, {
      headers: requestHeaders(cookies),
    }));
    updateCookies(cookies, verifyRequest);
    return {
      cookies,
      link,
      frameworkResult,
      publicResult: {
        status: verifyRequest.status,
        location: verifyRequest.headers.get("location") ?? "",
        body: await verifyRequest.text(),
      },
    };
  }

  async function consumeLink(link: string, cookies: CookieJar): Promise<Response> {
    const response = await handlers.GET(new NextRequest(link, { headers: requestHeaders(cookies) }));
    updateCookies(cookies, response);
    return response;
  }

  async function getPublicSession(cookies: CookieJar): Promise<unknown> {
    const response = await handlers.GET(request("/api/auth/session", "GET", cookies));
    return response.json();
  }

  async function signOut(cookies: CookieJar): Promise<Response> {
    const csrf = await handlers.GET(request("/api/auth/csrf", "GET", cookies));
    updateCookies(cookies, csrf);
    const csrfBody = await csrf.json() as { csrfToken?: unknown };
    if (typeof csrfBody.csrfToken !== "string") throw new Error("Auth.js fixture did not return CSRF token");
    const body = new URLSearchParams({ csrfToken: csrfBody.csrfToken, callbackUrl: "/" });
    const response = await handlers.POST(request("/api/auth/signout", "POST", cookies, body));
    updateCookies(cookies, response);
    return response;
  }

  return Object.freeze({
    requestMagicLink,
    consumeLink,
    getPublicSession,
    signOut,
    sessionCount: () => sessions.size,
  });
}

function userRecord(
  email: string,
  identity: Readonly<{ platformRole: "user" | "admin"; status: "active" | "suspended" | "deleted" }>,
  emailVerified = timestampFromDate(createdAt),
) {
  return create(UserRecordSchema, {
    id: identityId(identity.platformRole, identity.status),
    email,
    name: "Admin",
    emailVerified,
    platformRole: identity.platformRole,
    status: identity.status,
    version: BigInt(1),
    createdAt: timestampFromDate(createdAt),
    updatedAt: timestampFromDate(createdAt),
  });
}

function identityId(platformRole: string, status: string): string {
  const values: Readonly<Record<string, string>> = {
    "admin:active": "bce7762a-f7c7-4d22-8031-4336803038eb",
    "user:active": "25c79361-8202-408d-a70f-8c74bff1a8a0",
    "admin:suspended": "d13203e0-a0d7-44fe-ac44-6b3ed106c53c",
    "admin:deleted": "a9b6db5a-7347-474a-9ea7-787d81d40168",
  };
  return values[`${platformRole}:${status}`] ?? "";
}

function verificationKey(identifier: string, token: string): string {
  return `${identifier}\u0000${token}`;
}

function request(
  pathname: string,
  method: "GET" | "POST",
  cookies: CookieJar,
  body?: URLSearchParams,
): NextRequest {
  const headers = requestHeaders(cookies);
  headers.set("origin", baseUrl);
  if (body !== undefined) headers.set("content-type", "application/x-www-form-urlencoded");
  return new NextRequest(`${baseUrl}${pathname}`, { method, headers, body });
}

function requestHeaders(cookies: CookieJar): Headers {
  const headers = new Headers();
  if (cookies.size > 0) {
    headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  }
  return headers;
}

function updateCookies(cookies: CookieJar, response: Response): void {
  const values = (response.headers as Headers & Readonly<{ getSetCookie(): string[] }>).getSetCookie();
  for (const value of values) {
    const pair = value.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue === "") cookies.delete(name);
    else cookies.set(name, cookieValue);
  }
}

function runtimeConfig(): AdminRuntimeConfig {
  return {
    mode: "test",
    auth: { url: baseUrl, secret: "s".repeat(64), secureCookies: false },
    iam: {
      baseUrl: "http://127.0.0.1:4100",
      workloadToken: "a".repeat(64),
      requestLimitBytes: 64 * 1_024,
      responseLimitBytes: 1_024 * 1_024,
      timeoutMs: 15_000,
    },
    magicLinkMaxAgeSeconds: 600,
    smtp: { from: "no-reply@kokoro.local", host: "127.0.0.1", port: 1025, auth: null },
  };
}

import "server-only";

import { createHmac } from "node:crypto";

import NextAuth, { CredentialsSignin, type User } from "next-auth";
import { decode, encode } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";

import {
  SiteBffError,
  supersedeSiteDelivery,
  type OpaqueAuthSession,
  type SiteCredentialPair,
  type SiteDeliveryAttempt,
  type SiteRequestBudget,
} from "@kokoro/site-bff";

import { siteBff } from "./bff";
import { siteAuthSecret, sitePublicOrigin } from "./runtime-config";
import { site } from "./site-bootstrap";

export const SITE_SESSION_COOKIE = "__Host-kokoro.session-token";
export const SITE_AUTH_DELIVERY_COOKIE = "__Host-kokoro.auth-delivery";
const DELIVERY_TTL_SECONDS = 600;

type DeliveryFlow = "login" | "mfa";
type DeliveryState = Readonly<{
  siteBinding: string;
  flow: DeliveryFlow;
  inputDigest: string;
  commandId: string;
  idempotencyKey: string;
  receiptRecoveryCapability: string;
  priorCommandId?: string;
  exp: number;
}>;

type SiteAuthUser = User & Partial<SiteCredentialPair> & {
  pendingTransactionRef?: string;
  pendingChallengeKind?: "totp" | "recovery";
};

type SiteJwt = Record<string, unknown> & Partial<SiteCredentialPair> & {
  pendingTransactionRef?: string;
  pendingChallengeKind?: "totp" | "recovery";
  refreshCommandId?: string;
  refreshIdempotencyKey?: string;
  refreshRecoveryCapability?: string;
  refreshPriorCommandId?: string;
};

function siteBinding(): string {
  const deployment = siteBff().deploymentIdentity;
  return [
    site.siteKey,
    site.release.releaseId,
    deployment.deploymentRef,
    deployment.webArtifactDigest,
    deployment.publicOrigin,
  ].map((value) => `${value.length}:${value}`).join("|");
}

/** Browser-safe identity boundary. It rotates with the opaque Site session and exposes no Platform authority. */
export function browserRuntimeScope(auth: OpaqueAuthSession, projectRef: string): string {
  return createHmac("sha256", siteAuthSecret())
    .update("kokoro-site-browser-runtime-scope-v1\0")
    .update(siteBinding())
    .update("\0")
    .update(`${auth.sessionRef.length}:${auth.sessionRef}`)
    .update("\0")
    .update(`${projectRef.length}:${projectRef}`)
    .digest("base64url");
}

function deliveryDigest(flow: DeliveryFlow, values: readonly string[]): string {
  const body = [flow, siteBinding(), ...values].map((value) => `${value.length}:${value}`).join("|");
  const inputDigestKey = createHmac("sha256", siteAuthSecret())
    .update("kokoro-site-auth-delivery-input-v1")
    .digest();
  return createHmac("sha256", inputDigestKey).update(body).digest("hex");
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function pairFromToken(token: SiteJwt): SiteCredentialPair | null {
  const sessionRef = text(token.sessionRef, 256);
  const sessionCredential = text(token.sessionCredential, 4096);
  const sessionCredentialExpiresAt = text(token.sessionCredentialExpiresAt, 64);
  const refreshCredential = text(token.refreshCredential, 4096);
  const refreshCredentialExpiresAt = text(token.refreshCredentialExpiresAt, 64);
  return sessionRef && sessionCredential && sessionCredentialExpiresAt && refreshCredential && refreshCredentialExpiresAt
    ? { sessionRef, sessionCredential, sessionCredentialExpiresAt, refreshCredential, refreshCredentialExpiresAt }
    : null;
}

function credentialIsActive(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

function assembleChunkedCookie(
  entries: readonly Readonly<{ name: string; value: string }>[],
  name: string,
  maximumBytes = 32_768,
): string | null {
  const exact = entries.filter((entry) => entry.name === name);
  const prefix = `${name}.`;
  const chunks = entries.flatMap((entry) => {
    if (!entry.name.startsWith(prefix)) return [];
    const suffix = entry.name.slice(prefix.length);
    if (!/^\d+$/u.test(suffix)) return [{ index: -1, value: entry.value }];
    return [{ index: Number(suffix), value: entry.value }];
  });
  if (exact.length > 1 || (exact.length === 1 && chunks.length > 0)) return null;
  if (exact.length === 1) {
    const value = exact[0]!.value;
    return value.length > 0 && value.length <= maximumBytes ? value : null;
  }
  if (chunks.length === 0 || chunks.length > 16) return null;
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.some((chunk, index) => chunk.index !== index)) return null;
  const value = chunks.map((chunk) => chunk.value).join("");
  return value.length > 0 && value.length <= maximumBytes ? value : null;
}

function replaceCredentials(token: SiteJwt, pair: SiteCredentialPair): SiteJwt {
  delete token.pendingTransactionRef;
  delete token.pendingChallengeKind;
  clearRefreshRecovery(token);
  Object.assign(token, pair);
  return token;
}

function clearRefreshRecovery(token: SiteJwt): void {
  delete token.refreshCommandId;
  delete token.refreshIdempotencyKey;
  delete token.refreshRecoveryCapability;
  delete token.refreshPriorCommandId;
}

function refreshRecovery(token: SiteJwt): SiteDeliveryAttempt | null {
  const commandId = text(token.refreshCommandId, 64);
  const idempotencyKey = text(token.refreshIdempotencyKey, 128);
  const receiptRecoveryCapability = text(token.refreshRecoveryCapability, 512);
  const priorCommandId = text(token.refreshPriorCommandId, 64);
  if (commandId === null || idempotencyKey === null || receiptRecoveryCapability === null) return null;
  return {
    command: { commandId, idempotencyKey, receiptRecoveryCapability },
    ...(priorCommandId === null ? {} : { priorCommandId }),
  };
}

function setRefreshRecovery(token: SiteJwt, delivery: SiteDeliveryAttempt): void {
  token.refreshCommandId = delivery.command.commandId;
  token.refreshIdempotencyKey = delivery.command.idempotencyKey;
  token.refreshRecoveryCapability = delivery.command.receiptRecoveryCapability;
  if (delivery.priorCommandId === undefined) delete token.refreshPriorCommandId;
  else token.refreshPriorCommandId = delivery.priorCommandId;
}

function clearAuthority(token: SiteJwt): SiteJwt {
  for (const name of [
    "sessionRef", "sessionCredential", "sessionCredentialExpiresAt",
    "refreshCredential", "refreshCredentialExpiresAt", "pendingTransactionRef", "pendingChallengeKind",
    "refreshCommandId", "refreshIdempotencyKey", "refreshRecoveryCapability", "refreshPriorCommandId",
    "sub", "name", "email", "picture",
  ]) delete token[name];
  return token;
}

class DeliveryRecoveryRequired extends CredentialsSignin {
  code = "delivery_recovery_required";
}

function deliveryCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/", maxAge };
}

async function decodeDelivery(value: string | undefined): Promise<DeliveryState | null> {
  if (!value) return null;
  const raw = await decode({ token: value, secret: siteAuthSecret(), salt: SITE_AUTH_DELIVERY_COOKIE });
  if (raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const flow = candidate.flow;
  const exp = candidate.exp;
  if (
    candidate.siteBinding !== siteBinding() || (flow !== "login" && flow !== "mfa") ||
    typeof candidate.inputDigest !== "string" || !/^[0-9a-f]{64}$/u.test(candidate.inputDigest) ||
    typeof candidate.commandId !== "string" || !/^[0-9a-f]{32}$/u.test(candidate.commandId) ||
    typeof candidate.idempotencyKey !== "string" || !/^[0-9a-f]{48}$/u.test(candidate.idempotencyKey) ||
    typeof candidate.receiptRecoveryCapability !== "string" || !/^[0-9a-f]{64}$/u.test(candidate.receiptRecoveryCapability) ||
    (candidate.priorCommandId !== undefined && (typeof candidate.priorCommandId !== "string" || !/^[0-9a-f]{32}$/u.test(candidate.priorCommandId))) ||
    typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1_000)
  ) return null;
  return candidate as DeliveryState;
}

async function writeDelivery(state: Omit<DeliveryState, "siteBinding" | "exp">): Promise<void> {
  const value: DeliveryState = {
    ...state,
    siteBinding: siteBinding(),
    exp: Math.floor(Date.now() / 1_000) + DELIVERY_TTL_SECONDS,
  };
  const sealed = await encode({
    token: value,
    secret: siteAuthSecret(),
    salt: SITE_AUTH_DELIVERY_COOKIE,
    maxAge: DELIVERY_TTL_SECONDS,
  });
  (await cookies()).set(SITE_AUTH_DELIVERY_COOKIE, sealed, deliveryCookieOptions(DELIVERY_TTL_SECONDS));
}

async function clearDelivery(): Promise<void> {
  (await cookies()).set(SITE_AUTH_DELIVERY_COOKIE, "", deliveryCookieOptions(0));
}

export type AuthDeliveryPreparation =
  | Readonly<{ flow: "login"; email: string; password: string }>
  | Readonly<{ flow: "mfa"; transactionRef: string; code: string }>;

function preparationDigest(input: AuthDeliveryPreparation): string {
  return input.flow === "login"
    ? deliveryDigest("login", [input.email.trim().toLowerCase(), input.password])
    : deliveryDigest("mfa", [input.transactionRef, input.code]);
}

/** First request of the two-request ceremony: command authority is durable before any Platform RPC. */
export async function prepareAuthDelivery(input: AuthDeliveryPreparation, advance = false): Promise<void> {
  const digest = preparationDigest(input);
  const store = await cookies();
  const existing = await decodeDelivery(store.get(SITE_AUTH_DELIVERY_COOKIE)?.value);
  if (existing?.flow === input.flow && existing.inputDigest === digest && !advance) return;
  const fresh = siteBff().createOneTimeCommand();
  const superseding = advance && existing?.flow === input.flow && existing.inputDigest === digest;
  const attempt = superseding
    ? supersedeSiteDelivery({
        command: {
          commandId: existing.commandId,
          idempotencyKey: existing.idempotencyKey,
          receiptRecoveryCapability: existing.receiptRecoveryCapability,
        },
      }, fresh)
    : { command: fresh };
  await writeDelivery({
    flow: input.flow,
    inputDigest: digest,
    ...(attempt.priorCommandId === undefined ? {} : { priorCommandId: attempt.priorCommandId }),
    ...attempt.command,
  });
}

async function preparedDelivery(flow: DeliveryFlow, digest: string): Promise<SiteDeliveryAttempt | null> {
  const state = await decodeDelivery((await cookies()).get(SITE_AUTH_DELIVERY_COOKIE)?.value);
  if (state === null || state.flow !== flow || state.inputDigest !== digest) return null;
  return {
    command: {
      commandId: state.commandId,
      idempotencyKey: state.idempotencyKey,
      receiptRecoveryCapability: state.receiptRecoveryCapability,
    },
    ...(state.priorCommandId === undefined ? {} : { priorCommandId: state.priorCommandId }),
  };
}

const nextAuth = NextAuth({
  // Build artifacts are configuration-free. Runtime entry points validate the
  // deployment's non-public secret and canonical origin before any auth work.
  secret: process.env.AUTH_SECRET,
  trustHost: false,
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60, updateAge: 5 * 60 },
  cookies: {
    sessionToken: {
      name: SITE_SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
    },
  },
  providers: [Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      transactionRef: { label: "MFA transaction", type: "hidden" },
      code: { label: "Verification code", type: "text" },
    },
    async authorize(raw) {
      const transactionRef = text(raw.transactionRef, 256);
      const code = text(raw.code, 64);
      if (transactionRef !== null || code !== null) {
        if (transactionRef === null || code === null) return null;
        const digest = deliveryDigest("mfa", [transactionRef, code]);
        const delivery = await preparedDelivery("mfa", digest);
        if (delivery === null) return null;
        try {
          const pair = await siteBff().completeMfa({ transactionRef, code }, delivery);
          await clearDelivery();
          return { id: pair.sessionRef, ...pair } satisfies SiteAuthUser;
        } catch (error) {
          if (error instanceof SiteBffError && error.code === "AUTH_DELIVERY_UNAVAILABLE") {
            throw new DeliveryRecoveryRequired();
          }
          throw error;
        }
      }
      const email = text(raw.email, 320);
      const password = text(raw.password, 1024);
      if (email === null || password === null) return null;
      const digest = deliveryDigest("login", [email.trim().toLowerCase(), password]);
      const delivery = await preparedDelivery("login", digest);
      if (delivery === null) return null;
      try {
        const result = await siteBff().login({ email, password }, delivery);
        await clearDelivery();
        if (result.kind === "authenticated") {
          return { id: result.credentials.sessionRef, ...result.credentials } satisfies SiteAuthUser;
        }
        return {
          id: `mfa:${result.transactionRef}`,
          pendingTransactionRef: result.transactionRef,
          pendingChallengeKind: result.challengeKind,
        } satisfies SiteAuthUser;
      } catch (error) {
        if (error instanceof SiteBffError && error.code === "AUTH_DELIVERY_UNAVAILABLE") {
          throw new DeliveryRecoveryRequired();
        }
        throw error;
      }
    },
  })],
  callbacks: {
    async jwt({ token: rawToken, user }) {
      const token = rawToken as SiteJwt;
      if (user !== undefined) {
        clearAuthority(token);
        const authUser = user as SiteAuthUser;
        const pair = pairFromToken(authUser as unknown as SiteJwt);
        if (pair !== null) return replaceCredentials(token, pair);
        token.pendingTransactionRef = authUser.pendingTransactionRef;
        token.pendingChallengeKind = authUser.pendingChallengeKind;
        return token;
      }
      const pair = pairFromToken(token);
      if (pair === null) return token;
      if (credentialIsActive(pair.sessionCredentialExpiresAt, Date.now() + 60_000)) return token;
      if (!credentialIsActive(pair.refreshCredentialExpiresAt)) return clearAuthority(token);
      let delivery = refreshRecovery(token) ?? { command: siteBff().createOneTimeCommand() };
      setRefreshRecovery(token, delivery);
      try {
        return replaceCredentials(token, await siteBff().refresh(pair.refreshCredential, delivery));
      } catch (error) {
        if (!(error instanceof SiteBffError) || error.code !== "AUTH_DELIVERY_UNAVAILABLE") {
          return clearAuthority(token);
        }
        delivery = supersedeSiteDelivery(delivery, siteBff().createOneTimeCommand());
        setRefreshRecovery(token, delivery);
        try {
          return replaceCredentials(token, await siteBff().refresh(pair.refreshCredential, delivery));
        } catch (retryError) {
          // Keep the exact superseding identity in the encrypted token. The next JWT pass retries it.
          return retryError instanceof SiteBffError && retryError.code === "AUTH_DELIVERY_UNAVAILABLE"
            ? token
            : clearAuthority(token);
        }
      }
    },
    session({ session, token: rawToken }) {
      const token = rawToken as SiteJwt;
      const transactionRef = text(token.pendingTransactionRef, 256);
      return {
        expires: session.expires,
        authState: (() => {
          const pair = pairFromToken(token);
          return pair !== null && credentialIsActive(pair.sessionCredentialExpiresAt)
            ? "authenticated"
            : transactionRef !== null ? "mfa_required" : "anonymous";
        })(),
        ...(transactionRef === null ? {} : { mfaTransactionRef: transactionRef }),
      };
    },
  },
  events: {
    async signOut(message) {
      if (!("token" in message) || message.token === null) return;
      const pair = pairFromToken(message.token as SiteJwt);
      if (pair === null) return;
      await siteBff().revoke({
        sessionRef: pair.sessionRef,
        sessionCredential: pair.sessionCredential,
        expiresAt: pair.sessionCredentialExpiresAt,
      }).catch(() => undefined);
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

export async function auth() {
  sitePublicOrigin();
  return nextAuth.auth();
}

export function authRouteAllowed(request: Request): boolean {
  let origin: string, expectedOrigin: string;
  try {
    origin = new URL(request.url).origin;
    expectedOrigin = sitePublicOrigin();
  } catch {
    return false;
  }
  if (origin !== expectedOrigin) return false;
  if (request.method !== "POST") return true;
  return request.headers.get("origin") === expectedOrigin && request.headers.get("sec-fetch-site") === "same-origin";
}

function assertAuthReadBudget(request: SiteRequestBudget | undefined): void {
  if (request === undefined) return;
  request.remainingDeadlineMs();
  if (request.signal.aborted) throw request.signal.reason ?? new Error("Site auth read aborted");
}

export async function readOpaqueAuthSession(request?: SiteRequestBudget): Promise<OpaqueAuthSession | null> {
  assertAuthReadBudget(request);
  const cookieStore = await cookies();
  assertAuthReadBudget(request);
  const sealed = assembleChunkedCookie(cookieStore.getAll(), SITE_SESSION_COOKIE);
  if (!sealed) return null;
  const token = await decode({ token: sealed, secret: siteAuthSecret(), salt: SITE_SESSION_COOKIE });
  assertAuthReadBudget(request);
  const pair = token === null ? null : pairFromToken(token as SiteJwt);
  if (pair === null || !credentialIsActive(pair.sessionCredentialExpiresAt)) return null;
  return Object.freeze({
    sessionRef: pair.sessionRef,
    sessionCredential: pair.sessionCredential,
    expiresAt: pair.sessionCredentialExpiresAt,
  });
}

import "server-only";

import { createHmac } from "node:crypto";

import NextAuth, { CredentialsSignin, type User } from "next-auth";
import { decode, encode } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";

import {
  SiteBffError,
  type OpaqueAuthSession,
  type SiteCredentialPair,
  type SiteDeliveryAttempt,
} from "@kokoro/site-bff";

import { siteBff } from "./bff";
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

function secret(): string {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return value;
}

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

function deliveryDigest(flow: DeliveryFlow, values: readonly string[]): string {
  const body = [flow, siteBinding(), ...values].map((value) => `${value.length}:${value}`).join("|");
  const inputDigestKey = createHmac("sha256", secret())
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
  const raw = await decode({ token: value, secret: secret(), salt: SITE_AUTH_DELIVERY_COOKIE });
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
    secret: secret(),
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
  const command = siteBff().createOneTimeCommand();
  await writeDelivery({
    flow: input.flow,
    inputDigest: digest,
    ...(advance && existing?.flow === input.flow && existing.inputDigest === digest
      ? { priorCommandId: existing.commandId }
      : {}),
    ...command,
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

const configuredOrigin = process.env.KOKORO_SITE_PUBLIC_ORIGIN?.trim();
if (!configuredOrigin || process.env.AUTH_URL?.trim() !== configuredOrigin) {
  throw new Error("AUTH_URL must exactly equal KOKORO_SITE_PUBLIC_ORIGIN");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: secret(),
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
      if (pair === null || Date.parse(pair.sessionCredentialExpiresAt) > Date.now() + 60_000) return token;
      let delivery = refreshRecovery(token) ?? { command: siteBff().createOneTimeCommand() };
      setRefreshRecovery(token, delivery);
      try {
        return replaceCredentials(token, await siteBff().refresh(pair.refreshCredential, delivery));
      } catch (error) {
        if (!(error instanceof SiteBffError) || error.code !== "AUTH_DELIVERY_UNAVAILABLE") return token;
        delivery = {
          command: siteBff().createOneTimeCommand(),
          priorCommandId: delivery.command.commandId,
        };
        setRefreshRecovery(token, delivery);
        try {
          return replaceCredentials(token, await siteBff().refresh(pair.refreshCredential, delivery));
        } catch {
          // Keep the exact superseding identity in the encrypted token. The next JWT pass retries it.
          return token;
        }
      }
    },
    session({ session, token: rawToken }) {
      const token = rawToken as SiteJwt;
      const transactionRef = text(token.pendingTransactionRef, 256);
      return {
        expires: session.expires,
        authState: pairFromToken(token) !== null ? "authenticated" : transactionRef !== null ? "mfa_required" : "anonymous",
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

export function authRouteAllowed(request: Request): boolean {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (origin !== configuredOrigin) return false;
  if (request.method !== "POST") return true;
  return request.headers.get("origin") === configuredOrigin && request.headers.get("sec-fetch-site") === "same-origin";
}

export async function readOpaqueAuthSession(): Promise<OpaqueAuthSession | null> {
  const sealed = (await cookies()).get(SITE_SESSION_COOKIE)?.value;
  if (!sealed) return null;
  const token = await decode({ token: sealed, secret: secret(), salt: SITE_SESSION_COOKIE });
  const pair = token === null ? null : pairFromToken(token as SiteJwt);
  if (pair === null) return null;
  return Object.freeze({
    sessionRef: pair.sessionRef,
    sessionCredential: pair.sessionCredential,
    expiresAt: pair.sessionCredentialExpiresAt,
  });
}

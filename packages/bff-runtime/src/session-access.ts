import { z } from "zod";

import {
  runtimeEnvironmentSchema,
  validatedAuthSession,
  validatedSiteBootstrap,
  type AuthSession,
  type SiteBootstrap,
} from "./site-binding.js";

const reference = z.string().trim().min(1).max(256);
const shortReference = z.string().trim().min(1).max(128);
const credential = z.string().min(32).max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
const positiveUint64 = z.string().min(1).max(20)
  .regex(/^[1-9][0-9]{0,19}$/u)
  .refine((value) => value.length < 20 || value <= "18446744073709551615", "must fit a positive uint64");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const instant = z.iso.datetime({ offset: true });

export const SESSION_PURPOSES = Object.freeze({
  read: "session.read",
  write: "session.write",
  control: "session.control",
  stream: "session.stream",
} as const);

export type SessionPurpose = keyof typeof SESSION_PURPOSES;
export type SessionAudience = (typeof SESSION_PURPOSES)[SessionPurpose];

export type SessionGrantResource =
  | Readonly<{ readonly kind: "project" }>
  | Readonly<{ readonly kind: "session"; readonly sessionRef: string }>
  | Readonly<{ readonly kind: "run"; readonly sessionRef: string; readonly runRef: string }>;

export interface SessionGrantAuthorityPort {
  /** Adapter for generated issueSessionAccessGrant. Only its four request-body fields are caller-selected. */
  issueSessionAccessGrant(input: {
    readonly productContextRef: string;
    readonly projectRef: string;
    readonly purpose: SessionPurpose;
    readonly resource: SessionGrantResource;
    readonly authSessionRef: string;
    readonly authSessionCredential: string;
  }): Promise<unknown>;
}

const grantBindingSchema = z.strictObject({
  authorizationEpoch: positiveUint64,
  authorizationStreamSequence: positiveUint64,
  credentialEpoch: positiveUint64,
  productContextRef: reference,
  siteProjectBindingRef: reference,
  deploymentRef: reference,
  siteRef: shortReference,
  siteReleaseRef: shortReference,
  webArtifactDigest: sha256,
  runtimeEnvironment: runtimeEnvironmentSchema,
  region: shortReference,
  sessionContractRevision: shortReference,
  projectRef: reference,
  subjectRef: reference,
  subjectGeneration: positiveUint64,
  identitySessionRef: reference,
  identitySessionEpoch: positiveUint64,
  issuer: z.url().min(1).max(512),
  keyRevision: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  membershipEpoch: positiveUint64,
  notBefore: instant,
  policyEpoch: positiveUint64,
  restrictionEpoch: positiveUint64,
  revocationEpoch: positiveUint64,
  siteSecurityEpoch: positiveUint64,
  resource: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("project") }),
    z.strictObject({ kind: z.literal("session"), sessionRef: reference }),
    z.strictObject({ kind: z.literal("run"), sessionRef: reference, runRef: reference }),
  ]),
  issuedAt: instant,
  expiresAt: instant,
});

const authorizationSchema = z.discriminatedUnion("purpose", [
  z.strictObject({ purpose: z.literal("read"), audience: z.literal("session.read") }),
  z.strictObject({ purpose: z.literal("write"), audience: z.literal("session.write") }),
  z.strictObject({ purpose: z.literal("control"), audience: z.literal("session.control") }),
  z.strictObject({ purpose: z.literal("stream"), audience: z.literal("session.stream") }),
]);

const grantResponseSchema = z.strictObject({
  grant: z.strictObject({
    grantRef: reference,
    credential,
    binding: grantBindingSchema,
    authorization: authorizationSchema,
  }),
});

export interface SessionAccessGrant {
  readonly grantRef: string;
  readonly credential: string;
  readonly binding: Readonly<z.infer<typeof grantBindingSchema>>;
  readonly authorization: Readonly<z.infer<typeof authorizationSchema>>;
}

export class SessionAccessError extends Error {
  constructor(
    readonly code:
      | "PROJECT_NOT_ENABLED"
      | "GRANT_INVALID"
      | "GRANT_BINDING_MISMATCH"
      | "GRANT_LIFETIME_INVALID"
      | "AUTH_SESSION_STALE"
      | "BOOTSTRAP_STALE",
  ) {
    super(`Session access rejected: ${code}`);
    this.name = "SessionAccessError";
  }
}

function parseTime(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new SessionAccessError("GRANT_INVALID");
  return time;
}

function same(actual: string, expected: string): void {
  if (actual !== expected) throw new SessionAccessError("GRANT_BINDING_MISMATCH");
}

export interface SessionAccessManagerOptions {
  readonly bootstrap: SiteBootstrap;
  readonly authSession: AuthSession;
  readonly authority: SessionGrantAuthorityPort;
  readonly now?: () => Date;
  readonly refreshSkewMs?: number;
  readonly maximumGrantLifetimeMs?: number;
}

/** Server-only grant cache. No API exposes the opaque credential independently. */
export class SessionAccessManager {
  readonly #bootstrap: SiteBootstrap;
  readonly #authSession: Readonly<AuthSession>;
  readonly #authority: SessionGrantAuthorityPort;
  readonly #now: () => Date;
  readonly #refreshSkewMs: number;
  readonly #maximumGrantLifetimeMs: number;
  readonly #cache = new Map<string, SessionAccessGrant>();
  readonly #inFlight = new Map<string, Promise<SessionAccessGrant>>();

  constructor(options: SessionAccessManagerOptions) {
    this.#bootstrap = validatedSiteBootstrap(options.bootstrap);
    this.#authSession = validatedAuthSession(options.authSession);
    if (
      this.#authSession.subjectRef !== this.#bootstrap.actor.subjectRef ||
      this.#authSession.subjectGeneration !== this.#bootstrap.actor.subjectGeneration
    ) {
      throw new SessionAccessError("GRANT_BINDING_MISMATCH");
    }
    this.#authority = options.authority;
    this.#now = options.now ?? (() => new Date());
    this.#refreshSkewMs = options.refreshSkewMs ?? 15_000;
    this.#maximumGrantLifetimeMs = options.maximumGrantLifetimeMs ?? 300_000;
    if (
      this.#refreshSkewMs < 0 ||
      this.#refreshSkewMs > 120_000 ||
      this.#maximumGrantLifetimeMs < 1_000 ||
      this.#maximumGrantLifetimeMs > 300_000
    ) {
      throw new SessionAccessError("GRANT_LIFETIME_INVALID");
    }
  }

  invalidate(input?: { readonly purpose?: SessionPurpose; readonly projectRef?: string }): void {
    for (const key of this.#cache.keys()) {
      const [projectRef, purpose] = key.split("\u0000");
      if (
        (input?.purpose === undefined || purpose === input.purpose) &&
        (input?.projectRef === undefined || projectRef === input.projectRef)
      ) {
        this.#cache.delete(key);
      }
    }
  }

  async acquire(input: {
    readonly purpose: SessionPurpose;
    readonly resource: SessionGrantResource;
    readonly projectRef?: string;
    readonly forceRefresh?: boolean;
  }): Promise<SessionAccessGrant> {
    const projectRef = input.projectRef ?? this.#bootstrap.defaultProjectRef;
    if (!this.#bootstrap.projects.some((project) => project.projectRef === projectRef)) {
      throw new SessionAccessError("PROJECT_NOT_ENABLED");
    }
    const now = this.#now().getTime();
    if (parseTime(this.#authSession.expiresAt) <= now) {
      throw new SessionAccessError("AUTH_SESSION_STALE");
    }
    if (parseTime(this.#bootstrap.expiresAt) <= now) {
      throw new SessionAccessError("BOOTSTRAP_STALE");
    }
    const resourceResult = grantBindingSchema.shape.resource.safeParse(input.resource);
    if (!resourceResult.success) throw new SessionAccessError("GRANT_INVALID");
    const resource = resourceResult.data;
    const key = `${projectRef}\u0000${input.purpose}\u0000${JSON.stringify(resource)}`;
    const cached = this.#cache.get(key);
    if (
      input.forceRefresh !== true &&
      cached !== undefined &&
      parseTime(cached.binding.expiresAt) - this.#refreshSkewMs > now
    ) {
      return cached;
    }
    const existing = this.#inFlight.get(key);
    if (existing !== undefined) return existing;
    const pending = this.#issue(input.purpose, projectRef, resource, now).finally(() => {
      this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, pending);
    const grant = await pending;
    this.#cache.set(key, grant);
    return grant;
  }

  async #issue(
    purpose: SessionPurpose,
    projectRef: string,
    resource: SessionGrantResource,
    now: number,
  ): Promise<SessionAccessGrant> {
    const raw = await this.#authority.issueSessionAccessGrant({
      productContextRef: this.#bootstrap.productContextRef,
      projectRef,
      purpose,
      resource,
      authSessionRef: this.#authSession.sessionRef,
      authSessionCredential: this.#authSession.sessionCredential,
    });
    const result = grantResponseSchema.safeParse(raw);
    if (!result.success) throw new SessionAccessError("GRANT_INVALID");
    const grant = result.data.grant;
    const binding = grant.binding;
    const authorization = grant.authorization;
    same(authorization.purpose, purpose);
    same(authorization.audience, SESSION_PURPOSES[purpose]);
    same(binding.productContextRef, this.#bootstrap.productContextRef);
    same(binding.siteProjectBindingRef, this.#bootstrap.siteProjectBindingRef);
    same(binding.deploymentRef, this.#bootstrap.deploymentRef);
    same(binding.siteRef, this.#bootstrap.siteRef);
    same(binding.siteReleaseRef, this.#bootstrap.siteReleaseRef);
    same(binding.webArtifactDigest, this.#bootstrap.webArtifactDigest);
    same(binding.runtimeEnvironment, this.#bootstrap.runtimeEnvironment);
    same(binding.region, this.#bootstrap.region);
    same(binding.sessionContractRevision, this.#bootstrap.sessionContractRevision);
    same(binding.projectRef, projectRef);
    same(binding.subjectRef, this.#authSession.subjectRef);
    same(binding.subjectGeneration, this.#authSession.subjectGeneration);
    same(binding.identitySessionRef, this.#authSession.sessionRef);
    same(binding.policyEpoch, this.#bootstrap.policyEpoch);
    same(binding.revocationEpoch, this.#bootstrap.revocationEpoch);
    if (JSON.stringify(binding.resource) !== JSON.stringify(resource)) {
      throw new SessionAccessError("GRANT_BINDING_MISMATCH");
    }
    const issuedAt = parseTime(binding.issuedAt);
    const notBefore = parseTime(binding.notBefore);
    const expiresAt = parseTime(binding.expiresAt);
    const bootstrapExpiresAt = parseTime(this.#bootstrap.expiresAt);
    const authSessionExpiresAt = parseTime(this.#authSession.expiresAt);
    if (
      issuedAt > now + 30_000 ||
      notBefore < issuedAt - 30_000 ||
      notBefore > now + 30_000 ||
      expiresAt <= now + this.#refreshSkewMs ||
      expiresAt <= issuedAt ||
      expiresAt <= notBefore ||
      expiresAt - issuedAt > this.#maximumGrantLifetimeMs ||
      expiresAt > bootstrapExpiresAt ||
      expiresAt > authSessionExpiresAt
    ) {
      throw new SessionAccessError("GRANT_LIFETIME_INVALID");
    }
    return Object.freeze({
      grantRef: grant.grantRef,
      credential: grant.credential,
      binding: Object.freeze({ ...binding }),
      authorization: Object.freeze({ ...authorization }),
    });
  }
}

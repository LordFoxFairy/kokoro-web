import { z } from "zod";

const reference = z.string().trim().min(1).max(256);
const shortReference = z.string().trim().min(1).max(128);
const hasCredentialSeparator = (value: string) => Array.from(value).some((character) => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 32 || code === 127;
});
const credential = z.string().min(32).max(4096).refine(
  (value) => !hasCredentialSeparator(value),
  "credential contains whitespace or control characters",
);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const generation = z.string().min(1).max(20)
  .regex(/^[1-9][0-9]{0,19}$/u)
  .refine((value) => value.length < 20 || value <= "18446744073709551615", "must fit a positive uint64");
const instant = z.iso.datetime({ offset: true });
const runtimeEnvironmentSchema = z.enum(["development", "preview", "production"]);

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export interface SiteDeploymentBindingInput {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly siteProjectBindingRef: string;
  readonly deploymentRef: string;
  readonly siteReleaseRef: string;
  readonly webArtifactDigest: string;
  readonly workloadCredential: string;
  readonly sessionContractRevision: string;
  readonly region: string;
  readonly productAudience: string;
  readonly localUnsafeSiteBinding?: boolean;
}

export interface SiteDeploymentBinding extends Omit<SiteDeploymentBindingInput, "localUnsafeSiteBinding"> {
  readonly trustMode: "registered" | "local_unsafe_watermarked";
}

export interface UnsafeBindingAuditPort {
  emit(event: {
    readonly kind: "local_unsafe_site_binding_enabled";
    readonly deploymentRef: string;
    readonly watermark: "KOKORO LOCAL UNSAFE SITE BINDING";
  }): void;
}

export class SiteBindingError extends Error {
  constructor(
    readonly code:
      | "DEPLOYMENT_BINDING_INVALID"
      | "LOCAL_UNSAFE_PRODUCTION_FORBIDDEN"
      | "AUTH_SESSION_INVALID"
      | "PRODUCT_CONTEXT_INVALID"
      | "PRODUCT_CONTEXT_MISMATCH"
      | "PRODUCT_CONTEXT_STALE"
      | "PERSONAL_CONTEXT_INVALID"
      | "PERSONAL_CONTEXT_MISMATCH"
      | "PERSONAL_CONTEXT_STALE"
      | "SITE_BOOTSTRAP_INVALID",
  ) {
    super(`Site BFF binding rejected: ${code}`);
    this.name = "SiteBindingError";
  }
}

const deploymentBindingInputSchema = z.strictObject({
  runtimeEnvironment: runtimeEnvironmentSchema,
  siteProjectBindingRef: reference,
  deploymentRef: reference,
  siteReleaseRef: shortReference,
  webArtifactDigest: sha256,
  workloadCredential: credential,
  sessionContractRevision: shortReference,
  region: shortReference,
  productAudience: reference,
  localUnsafeSiteBinding: z.boolean().optional(),
});

/** Host, query, caller headers and default Site identifiers are deliberately absent. */
export function loadSiteDeploymentBinding(
  input: SiteDeploymentBindingInput,
  unsafeAudit?: UnsafeBindingAuditPort,
): Readonly<SiteDeploymentBinding> {
  const parsed = deploymentBindingInputSchema.safeParse(input);
  if (!parsed.success) throw new SiteBindingError("DEPLOYMENT_BINDING_INVALID");
  const localUnsafe = parsed.data.localUnsafeSiteBinding === true;
  if (localUnsafe && parsed.data.runtimeEnvironment === "production") {
    throw new SiteBindingError("LOCAL_UNSAFE_PRODUCTION_FORBIDDEN");
  }
  if (localUnsafe) {
    if (unsafeAudit === undefined) throw new SiteBindingError("DEPLOYMENT_BINDING_INVALID");
    unsafeAudit.emit({
      kind: "local_unsafe_site_binding_enabled",
      deploymentRef: parsed.data.deploymentRef,
      watermark: "KOKORO LOCAL UNSAFE SITE BINDING",
    });
  }
  return Object.freeze({
    runtimeEnvironment: parsed.data.runtimeEnvironment,
    siteProjectBindingRef: parsed.data.siteProjectBindingRef,
    deploymentRef: parsed.data.deploymentRef,
    siteReleaseRef: parsed.data.siteReleaseRef,
    webArtifactDigest: parsed.data.webArtifactDigest,
    workloadCredential: parsed.data.workloadCredential,
    sessionContractRevision: parsed.data.sessionContractRevision,
    region: parsed.data.region,
    productAudience: parsed.data.productAudience,
    trustMode: localUnsafe ? "local_unsafe_watermarked" : "registered",
  });
}

export function assertProductionSafeBinding(binding: SiteDeploymentBinding): void {
  if (binding.runtimeEnvironment === "production" && binding.trustMode !== "registered") {
    throw new SiteBindingError("LOCAL_UNSAFE_PRODUCTION_FORBIDDEN");
  }
}

export interface OpaqueAuthSession {
  readonly sessionRef: string;
  readonly sessionCredential: string;
  readonly expiresAt: string;
}

export interface AuthSession extends OpaqueAuthSession {
  readonly subjectRef: string;
  readonly subjectGeneration: string;
}

const opaqueAuthSessionSchema = z.strictObject({
  sessionRef: reference,
  sessionCredential: credential,
  expiresAt: instant,
});

const authSessionSchema = opaqueAuthSessionSchema.extend({
  subjectRef: reference,
  subjectGeneration: generation,
});

export function validatedOpaqueAuthSession(input: OpaqueAuthSession): Readonly<OpaqueAuthSession> {
  const result = opaqueAuthSessionSchema.safeParse(input);
  if (!result.success) throw new SiteBindingError("AUTH_SESSION_INVALID");
  return Object.freeze({ ...result.data });
}

export function validatedAuthSession(input: AuthSession): Readonly<AuthSession> {
  const result = authSessionSchema.safeParse(input);
  if (!result.success) throw new SiteBindingError("AUTH_SESSION_INVALID");
  return Object.freeze({ ...result.data });
}

const localePolicySchema = z.strictObject({
  defaultLocale: z.string().trim().min(2).max(35),
  allowedLocales: z.array(z.string().trim().min(2).max(35)).min(1).max(64),
}).superRefine((policy, issues) => {
  if (new Set(policy.allowedLocales).size !== policy.allowedLocales.length) {
    issues.addIssue({ code: "custom", path: ["allowedLocales"], message: "must be unique" });
  }
  if (!policy.allowedLocales.includes(policy.defaultLocale)) {
    issues.addIssue({ code: "custom", path: ["defaultLocale"], message: "must be allowed" });
  }
});

const publicToken = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/u);
const uniquePublicTokens = (minimum: number) => z.array(publicToken).min(minimum).max(16)
  .refine((values) => new Set(values).size === values.length, "must be unique");
const publishedModelOptionSchema = z.strictObject({
  modelOptionRevisionRef: reference,
  optionKey: z.string().regex(/^[a-z][a-z0-9._-]{1,127}$/u),
  label: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  inputModalities: uniquePublicTokens(1),
  outputModalities: uniquePublicTokens(1),
  supportedEfforts: uniquePublicTokens(0),
  badges: uniquePublicTokens(0),
  availability: z.enum(["available", "temporarily_unavailable"]),
});
const surfaceModelOptionCatalogSchema = z.strictObject({
  surfaceId: shortReference,
  catalogRevisionRef: reference,
  defaultModelOptionRevisionRef: reference,
  options: z.array(publishedModelOptionSchema).min(1).max(256),
  publishedAt: instant,
}).superRefine((catalog, issues) => {
  const optionRefs = catalog.options.map(({ modelOptionRevisionRef }) => modelOptionRevisionRef);
  const optionKeys = catalog.options.map(({ optionKey }) => optionKey);
  if (new Set(optionRefs).size !== optionRefs.length) {
    issues.addIssue({ code: "custom", path: ["options"], message: "model option refs must be unique" });
  }
  if (new Set(optionKeys).size !== optionKeys.length) {
    issues.addIssue({ code: "custom", path: ["options"], message: "model option keys must be unique" });
  }
  const selectedDefault = catalog.options.find(
    ({ modelOptionRevisionRef }) => modelOptionRevisionRef === catalog.defaultModelOptionRevisionRef,
  );
  if (selectedDefault?.availability !== "available") {
    issues.addIssue({
      code: "custom",
      path: ["defaultModelOptionRevisionRef"],
      message: "default must identify an available published option",
    });
  }
});

const productContextSchema = z.strictObject({
  productContextRef: reference,
  siteProjectBindingRef: reference,
  deploymentRef: reference,
  siteRef: shortReference,
  siteReleaseRef: shortReference,
  webArtifactDigest: sha256,
  runtimeEnvironment: runtimeEnvironmentSchema,
  region: shortReference,
  audience: reference,
  sessionContractRevision: shortReference,
  policyEpoch: generation,
  revocationEpoch: generation,
  enabledSurfaceIds: z.array(shortReference).max(256),
  featurePolicyRevision: shortReference,
  modelOptionCatalogRef: reference,
  modelOptionCatalogs: z.array(surfaceModelOptionCatalogSchema).max(64),
  agentCatalogRef: reference,
  localePolicy: localePolicySchema,
  cacheMaxAgeSeconds: z.number().int().min(0).max(300),
  issuedAt: instant,
  expiresAt: instant,
}).superRefine((context, issues) => {
  if (new Set(context.enabledSurfaceIds).size !== context.enabledSurfaceIds.length) {
    issues.addIssue({ code: "custom", path: ["enabledSurfaceIds"], message: "must be unique" });
  }
  const catalogSurfaces = context.modelOptionCatalogs.map(({ surfaceId }) => surfaceId);
  if (new Set(catalogSurfaces).size !== catalogSurfaces.length) {
    issues.addIssue({ code: "custom", path: ["modelOptionCatalogs"], message: "surfaceId must be unique" });
  }
  if (catalogSurfaces.some((surfaceId) => !context.enabledSurfaceIds.includes(surfaceId))) {
    issues.addIssue({ code: "custom", path: ["modelOptionCatalogs"], message: "surface must be enabled" });
  }
  for (const productSurface of ["chat", "image", "music", "video"] as const) {
    if (context.enabledSurfaceIds.includes(productSurface) && !catalogSurfaces.includes(productSurface)) {
      issues.addIssue({
        code: "custom",
        path: ["modelOptionCatalogs"],
        message: `enabled ${productSurface} surface requires a catalog`,
      });
    }
  }
});

const commandReceiptSchema = z.strictObject({
  commandId: z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u),
  committedAt: instant,
  receiptRef: reference,
  requestDigest: sha256,
  state: z.literal("committed"),
});

const productContextExchangeResponseSchema = z.strictObject({
  receipt: commandReceiptSchema,
  context: productContextSchema,
});

export interface LocalePolicy {
  readonly defaultLocale: string;
  readonly allowedLocales: readonly string[];
}

export interface PublishedModelOption {
  readonly modelOptionRevisionRef: string;
  readonly optionKey: string;
  readonly label: string;
  readonly description?: string;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly supportedEfforts: readonly string[];
  readonly badges: readonly string[];
  readonly availability: "available" | "temporarily_unavailable";
}

export interface SurfaceModelOptionCatalog {
  readonly surfaceId: string;
  readonly catalogRevisionRef: string;
  readonly defaultModelOptionRevisionRef: string;
  readonly options: readonly PublishedModelOption[];
  readonly publishedAt: string;
}

export interface ProductContext {
  readonly productContextRef: string;
  readonly siteProjectBindingRef: string;
  readonly deploymentRef: string;
  readonly siteRef: string;
  readonly siteReleaseRef: string;
  readonly webArtifactDigest: string;
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly region: string;
  readonly audience: string;
  readonly sessionContractRevision: string;
  readonly policyEpoch: string;
  readonly revocationEpoch: string;
  readonly enabledSurfaceIds: readonly string[];
  readonly featurePolicyRevision: string;
  readonly modelOptionCatalogRef: string;
  readonly modelOptionCatalogs: readonly SurfaceModelOptionCatalog[];
  readonly agentCatalogRef: string;
  readonly localePolicy: LocalePolicy;
  readonly cacheMaxAgeSeconds: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface PlatformProductContextPort {
  /** Adapter for generated exchangeProductContext; binding is transport security, not request JSON. */
  exchangeProductContext(input: {
    readonly binding: SiteDeploymentBinding;
    readonly commandRef: string;
    readonly command: Readonly<{ commandId: string; idempotencyKey: string }>;
  }, request?: ProductContextRequestOptions): Promise<unknown>;
}

export interface ProductContextRequestOptions {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
}

export interface ProductContextCommandFactoryPort {
  /** A new value is created per refresh attempt; transport retries reuse the same returned identity. */
  create(): Readonly<{
    commandRef: string;
    commandId: string;
    idempotencyKey: string;
  }>;
}

const productContextCommandSchema = z.strictObject({
  commandRef: shortReference,
  commandId: z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u),
  idempotencyKey: z.string().min(16).max(191),
});

function millis(value: string, invalidCode: SiteBindingError["code"]): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new SiteBindingError(invalidCode);
  return parsed;
}

function same(actual: string, expected: string, code: SiteBindingError["code"]): void {
  if (actual !== expected) throw new SiteBindingError(code);
}

function freezeProductContext(input: unknown): ProductContext {
  const result = productContextExchangeResponseSchema.safeParse(input);
  if (!result.success) throw new SiteBindingError("PRODUCT_CONTEXT_INVALID");
  const context = result.data.context;
  return Object.freeze({
    ...context,
    enabledSurfaceIds: Object.freeze([...context.enabledSurfaceIds]),
    modelOptionCatalogs: freezeModelOptionCatalogs(context.modelOptionCatalogs),
    localePolicy: Object.freeze({
      ...context.localePolicy,
      allowedLocales: Object.freeze([...context.localePolicy.allowedLocales]),
    }),
  });
}

export interface ProductContextManagerOptions {
  readonly binding: SiteDeploymentBinding;
  readonly authority: PlatformProductContextPort;
  readonly commandFactory: ProductContextCommandFactoryPort;
  readonly now?: () => Date;
  readonly refreshSkewMs?: number;
  readonly maximumLifetimeMs?: number;
}

/** One deployment-scoped, user-free ProductContext cache. */
export class ProductContextManager {
  readonly #binding: Readonly<SiteDeploymentBinding>;
  readonly #authority: PlatformProductContextPort;
  readonly #commandFactory: ProductContextCommandFactoryPort;
  readonly #now: () => Date;
  readonly #refreshSkewMs: number;
  readonly #maximumLifetimeMs: number;
  #cached: ProductContext | undefined;
  #cachedAt = 0;
  #inFlight: Promise<ProductContext> | undefined;
  #lastCommandRef: string | undefined;
  #lastCommandId: string | undefined;
  #lastIdempotencyKey: string | undefined;

  constructor(options: ProductContextManagerOptions) {
    assertProductionSafeBinding(options.binding);
    this.#binding = Object.freeze({ ...options.binding });
    this.#authority = options.authority;
    this.#commandFactory = options.commandFactory;
    this.#now = options.now ?? (() => new Date());
    this.#refreshSkewMs = options.refreshSkewMs ?? 15_000;
    this.#maximumLifetimeMs = options.maximumLifetimeMs ?? 300_000;
    if (
      this.#refreshSkewMs < 0 ||
      this.#refreshSkewMs > 120_000 ||
      this.#maximumLifetimeMs < 1_000 ||
      this.#maximumLifetimeMs > 900_000
    ) {
      throw new SiteBindingError("DEPLOYMENT_BINDING_INVALID");
    }
  }

  invalidate(): void {
    this.#cached = undefined;
    this.#cachedAt = 0;
  }

  async acquire(
    forceRefresh = false,
    request?: ProductContextRequestOptions,
  ): Promise<ProductContext> {
    const now = this.#now().getTime();
    if (
      !forceRefresh &&
      this.#cached !== undefined &&
      Math.min(
        this.#cachedAt + this.#cached.cacheMaxAgeSeconds * 1_000,
        millis(this.#cached.expiresAt, "PRODUCT_CONTEXT_INVALID") - this.#refreshSkewMs,
      ) > now
    ) {
      return this.#cached;
    }
    if (request !== undefined) {
      const context = await this.#exchange(now, request);
      this.#cached = context;
      this.#cachedAt = now;
      return context;
    }
    if (this.#inFlight !== undefined) return this.#inFlight;
    this.#inFlight = this.#exchange(now).finally(() => {
      this.#inFlight = undefined;
    });
    const context = await this.#inFlight;
    this.#cached = context;
    this.#cachedAt = now;
    return context;
  }

  async #exchange(now: number, request?: ProductContextRequestOptions): Promise<ProductContext> {
    const commandResult = productContextCommandSchema.safeParse(this.#commandFactory.create());
    if (!commandResult.success) throw new SiteBindingError("PRODUCT_CONTEXT_INVALID");
    const command = commandResult.data;
    if (
      command.commandRef === this.#lastCommandRef ||
      command.commandId === this.#lastCommandId ||
      command.idempotencyKey === this.#lastIdempotencyKey
    ) {
      throw new SiteBindingError("PRODUCT_CONTEXT_INVALID");
    }
    this.#lastCommandRef = command.commandRef;
    this.#lastCommandId = command.commandId;
    this.#lastIdempotencyKey = command.idempotencyKey;
    const response = await this.#authority.exchangeProductContext({
      binding: this.#binding,
      commandRef: command.commandRef,
      command: { commandId: command.commandId, idempotencyKey: command.idempotencyKey },
    }, request);
    const parsedResponse = productContextExchangeResponseSchema.safeParse(response);
    if (!parsedResponse.success || parsedResponse.data.receipt.commandId !== command.commandId) {
      throw new SiteBindingError("PRODUCT_CONTEXT_INVALID");
    }
    const context = freezeProductContext(response);
    same(context.siteProjectBindingRef, this.#binding.siteProjectBindingRef, "PRODUCT_CONTEXT_MISMATCH");
    same(context.deploymentRef, this.#binding.deploymentRef, "PRODUCT_CONTEXT_MISMATCH");
    same(context.siteReleaseRef, this.#binding.siteReleaseRef, "PRODUCT_CONTEXT_MISMATCH");
    same(context.webArtifactDigest, this.#binding.webArtifactDigest, "PRODUCT_CONTEXT_MISMATCH");
    same(context.runtimeEnvironment, this.#binding.runtimeEnvironment, "PRODUCT_CONTEXT_MISMATCH");
    same(context.region, this.#binding.region, "PRODUCT_CONTEXT_MISMATCH");
    same(context.audience, this.#binding.productAudience, "PRODUCT_CONTEXT_MISMATCH");
    same(context.sessionContractRevision, this.#binding.sessionContractRevision, "PRODUCT_CONTEXT_MISMATCH");
    const issuedAt = millis(context.issuedAt, "PRODUCT_CONTEXT_INVALID");
    const expiresAt = millis(context.expiresAt, "PRODUCT_CONTEXT_INVALID");
    if (
      issuedAt > now + 30_000 ||
      expiresAt <= now + this.#refreshSkewMs ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > this.#maximumLifetimeMs ||
      now + context.cacheMaxAgeSeconds * 1_000 > expiresAt
    ) {
      throw new SiteBindingError("PRODUCT_CONTEXT_STALE");
    }
    return context;
  }
}

export interface PlatformPersonalContextPort {
  /** Adapter for generated getPersonalContext; no user or product authority enters response DTOs from browser input. */
  getPersonalContext(input: {
    readonly productContextRef: string;
    readonly authSessionRef: string;
    readonly authSessionCredential: string;
  }): Promise<unknown>;
}

const safeActorSchema = z.strictObject({
  subjectRef: reference,
  subjectGeneration: generation,
  state: z.literal("active"),
  displayName: z.string().trim().min(1).max(160),
  avatarUrl: z.url().max(2048).nullable(),
});

const projectSummarySchema = z.strictObject({
  projectRef: reference,
  workspaceRef: reference,
  executionSpaceRef: reference,
  displayName: z.string().trim().min(1).max(160),
  membershipRevision: shortReference,
});

const personalContextSchema = z.strictObject({
  personalContextRef: reference,
  productContextRef: reference,
  actor: safeActorSchema,
  projects: z.array(projectSummarySchema).min(1).max(256),
  defaultProjectRef: reference,
  contextRevision: shortReference,
  issuedAt: instant,
  expiresAt: instant,
}).superRefine((context, issues) => {
  const projectRefs = context.projects.map(({ projectRef }) => projectRef);
  if (new Set(projectRefs).size !== projectRefs.length) {
    issues.addIssue({ code: "custom", path: ["projects"], message: "projectRef must be unique" });
  }
  if (!projectRefs.includes(context.defaultProjectRef)) {
    issues.addIssue({ code: "custom", path: ["defaultProjectRef"], message: "must identify a project" });
  }
});

export interface SafeActor {
  readonly subjectRef: string;
  readonly subjectGeneration: string;
  readonly state: "active";
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface ProjectSummary {
  readonly projectRef: string;
  readonly workspaceRef: string;
  readonly executionSpaceRef: string;
  readonly displayName: string;
  readonly membershipRevision: string;
}

const siteBootstrapSchema = z.strictObject({
  productContextRef: reference,
  personalContextRef: reference,
  siteProjectBindingRef: reference,
  deploymentRef: reference,
  siteRef: shortReference,
  siteReleaseRef: shortReference,
  webArtifactDigest: sha256,
  runtimeEnvironment: runtimeEnvironmentSchema,
  region: shortReference,
  productAudience: reference,
  sessionContractRevision: shortReference,
  policyEpoch: generation,
  revocationEpoch: generation,
  actor: safeActorSchema,
  projects: z.array(projectSummarySchema).min(1).max(256),
  defaultProjectRef: reference,
  enabledSurfaceIds: z.array(shortReference).max(256),
  featurePolicyRevision: shortReference,
  modelOptionCatalogRef: reference,
  modelOptionCatalogs: z.array(surfaceModelOptionCatalogSchema).max(64),
  agentCatalogRef: reference,
  localePolicy: localePolicySchema,
  issuedAt: instant,
  expiresAt: instant,
  cacheMaxAgeSeconds: z.number().int().min(0).max(300),
});

export interface SiteBootstrap {
  readonly productContextRef: string;
  readonly personalContextRef: string;
  readonly siteProjectBindingRef: string;
  readonly deploymentRef: string;
  readonly siteRef: string;
  readonly siteReleaseRef: string;
  readonly webArtifactDigest: string;
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly region: string;
  readonly productAudience: string;
  readonly sessionContractRevision: string;
  readonly policyEpoch: string;
  readonly revocationEpoch: string;
  readonly actor: SafeActor;
  readonly projects: readonly ProjectSummary[];
  readonly defaultProjectRef: string;
  readonly enabledSurfaceIds: readonly string[];
  readonly featurePolicyRevision: string;
  readonly modelOptionCatalogRef: string;
  readonly modelOptionCatalogs: readonly SurfaceModelOptionCatalog[];
  readonly agentCatalogRef: string;
  readonly localePolicy: LocalePolicy;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly cacheMaxAgeSeconds: number;
}

export function validatedSiteBootstrap(input: unknown): SiteBootstrap {
  const result = siteBootstrapSchema.safeParse(input);
  if (!result.success) throw new SiteBindingError("SITE_BOOTSTRAP_INVALID");
  const value = result.data;
  const projectRefs = value.projects.map(({ projectRef }) => projectRef);
  if (
    new Set(projectRefs).size !== projectRefs.length ||
    !projectRefs.includes(value.defaultProjectRef) ||
    new Set(value.enabledSurfaceIds).size !== value.enabledSurfaceIds.length
  ) {
    throw new SiteBindingError("SITE_BOOTSTRAP_INVALID");
  }
  return Object.freeze({
    ...value,
    actor: Object.freeze({ ...value.actor }),
    enabledSurfaceIds: Object.freeze([...value.enabledSurfaceIds]),
    modelOptionCatalogs: freezeModelOptionCatalogs(value.modelOptionCatalogs),
    projects: Object.freeze(value.projects.map((project) => Object.freeze({ ...project }))),
    localePolicy: Object.freeze({
      ...value.localePolicy,
      allowedLocales: Object.freeze([...value.localePolicy.allowedLocales]),
    }),
  });
}

export interface ResolvedSiteRuntime {
  readonly authSession: Readonly<AuthSession>;
  readonly bootstrap: SiteBootstrap;
}

/**
 * Resolves authoritative actor claims from Platform using only the opaque credential held by Auth.js.
 * The Site must never decode the credential or persist actor authority in its browser-visible session.
 */
export async function bootstrapSiteRuntimeFromOpaqueSession(input: {
  readonly productContexts: ProductContextManager;
  readonly authSession: OpaqueAuthSession;
  readonly personalAuthority: PlatformPersonalContextPort;
  readonly now?: () => Date;
  readonly maximumPersonalContextLifetimeMs?: number;
  readonly productContextRequest?: ProductContextRequestOptions;
}): Promise<ResolvedSiteRuntime> {
  const now = (input.now ?? (() => new Date()))().getTime();
  const maximumLifetimeMs = input.maximumPersonalContextLifetimeMs ?? 300_000;
  if (maximumLifetimeMs < 1_000 || maximumLifetimeMs > 900_000) {
    throw new SiteBindingError("PERSONAL_CONTEXT_INVALID");
  }
  const authSession = validatedOpaqueAuthSession(input.authSession);
  const authExpiresAt = millis(authSession.expiresAt, "AUTH_SESSION_INVALID");
  if (authExpiresAt <= now) throw new SiteBindingError("AUTH_SESSION_INVALID");
  const product = await input.productContexts.acquire(false, input.productContextRequest);
  const personalResult = personalContextSchema.safeParse(await input.personalAuthority.getPersonalContext({
    productContextRef: product.productContextRef,
    authSessionRef: authSession.sessionRef,
    authSessionCredential: authSession.sessionCredential,
  }));
  if (!personalResult.success) throw new SiteBindingError("PERSONAL_CONTEXT_INVALID");
  const personal = personalResult.data;
  same(personal.productContextRef, product.productContextRef, "PERSONAL_CONTEXT_MISMATCH");
  const issuedAt = millis(personal.issuedAt, "PERSONAL_CONTEXT_INVALID");
  const expiresAt = millis(personal.expiresAt, "PERSONAL_CONTEXT_INVALID");
  const productExpiresAt = millis(product.expiresAt, "PRODUCT_CONTEXT_INVALID");
  const productIssuedAt = millis(product.issuedAt, "PRODUCT_CONTEXT_INVALID");
  if (
    issuedAt > now + 30_000 ||
    issuedAt + 30_000 < productIssuedAt ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maximumLifetimeMs ||
    expiresAt > authExpiresAt ||
    expiresAt > productExpiresAt
  ) {
    throw new SiteBindingError("PERSONAL_CONTEXT_STALE");
  }
  const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1_000));
  const bootstrap = validatedSiteBootstrap({
    productContextRef: product.productContextRef,
    personalContextRef: personal.personalContextRef,
    siteProjectBindingRef: product.siteProjectBindingRef,
    deploymentRef: product.deploymentRef,
    siteRef: product.siteRef,
    siteReleaseRef: product.siteReleaseRef,
    webArtifactDigest: product.webArtifactDigest,
    runtimeEnvironment: product.runtimeEnvironment,
    region: product.region,
    productAudience: product.audience,
    sessionContractRevision: product.sessionContractRevision,
    policyEpoch: product.policyEpoch,
    revocationEpoch: product.revocationEpoch,
    actor: personal.actor,
    projects: personal.projects,
    defaultProjectRef: personal.defaultProjectRef,
    enabledSurfaceIds: product.enabledSurfaceIds,
    featurePolicyRevision: product.featurePolicyRevision,
    modelOptionCatalogRef: product.modelOptionCatalogRef,
    modelOptionCatalogs: product.modelOptionCatalogs,
    agentCatalogRef: product.agentCatalogRef,
    localePolicy: product.localePolicy,
    issuedAt: personal.issuedAt,
    expiresAt: personal.expiresAt,
    cacheMaxAgeSeconds: Math.min(product.cacheMaxAgeSeconds, remainingSeconds),
  });
  return Object.freeze({
    authSession: validatedAuthSession({
      ...authSession,
      subjectRef: personal.actor.subjectRef,
      subjectGeneration: personal.actor.subjectGeneration,
    }),
    bootstrap,
  });
}

/** Compatibility entry point for callers that already hold server-resolved actor authority. */
export async function bootstrapSiteRuntime(input: {
  readonly productContexts: ProductContextManager;
  readonly authSession: AuthSession;
  readonly personalAuthority: PlatformPersonalContextPort;
  readonly now?: () => Date;
  readonly maximumPersonalContextLifetimeMs?: number;
}): Promise<SiteBootstrap> {
  const expected = validatedAuthSession(input.authSession);
  const resolved = await bootstrapSiteRuntimeFromOpaqueSession({
    ...input,
    authSession: {
      sessionRef: expected.sessionRef,
      sessionCredential: expected.sessionCredential,
      expiresAt: expected.expiresAt,
    },
  });
  same(resolved.authSession.subjectRef, expected.subjectRef, "PERSONAL_CONTEXT_MISMATCH");
  same(resolved.authSession.subjectGeneration, expected.subjectGeneration, "PERSONAL_CONTEXT_MISMATCH");
  return resolved.bootstrap;
}

export interface PublicSiteBootstrap {
  actor: Readonly<{ displayName: string; avatarUrl: string | null }>;
  readonly enabledSurfaceIds: readonly string[];
  readonly featurePolicyRevision: string;
  readonly projects: readonly ProjectSummary[];
  readonly defaultProjectRef: string;
  readonly modelOptionCatalogRef: string;
  readonly modelOptionCatalogs: readonly SurfaceModelOptionCatalog[];
  readonly agentCatalogRef: string;
  readonly localePolicy: LocalePolicy;
  readonly sessionContractRevision: string;
  readonly cacheMaxAgeSeconds: number;
}

/** Browser-safe view deliberately excludes Site authority, subject authority and all credentials. */
export function publicSiteBootstrap(bootstrap: SiteBootstrap): Readonly<PublicSiteBootstrap> {
  return Object.freeze({
    actor: Object.freeze({
      displayName: bootstrap.actor.displayName,
      avatarUrl: bootstrap.actor.avatarUrl,
    }),
    enabledSurfaceIds: bootstrap.enabledSurfaceIds,
    featurePolicyRevision: bootstrap.featurePolicyRevision,
    projects: bootstrap.projects,
    defaultProjectRef: bootstrap.defaultProjectRef,
    modelOptionCatalogRef: bootstrap.modelOptionCatalogRef,
    modelOptionCatalogs: bootstrap.modelOptionCatalogs,
    agentCatalogRef: bootstrap.agentCatalogRef,
    localePolicy: bootstrap.localePolicy,
    sessionContractRevision: bootstrap.sessionContractRevision,
    cacheMaxAgeSeconds: bootstrap.cacheMaxAgeSeconds,
  });
}

function freezeModelOptionCatalogs(
  catalogs: readonly z.infer<typeof surfaceModelOptionCatalogSchema>[],
): readonly SurfaceModelOptionCatalog[] {
  return Object.freeze(catalogs.map((catalog) => Object.freeze({
    ...catalog,
    options: Object.freeze(catalog.options.map((option) => Object.freeze({
      ...option,
      inputModalities: Object.freeze([...option.inputModalities]),
      outputModalities: Object.freeze([...option.outputModalities]),
      supportedEfforts: Object.freeze([...option.supportedEfforts]),
      badges: Object.freeze([...option.badges]),
    }))),
  })));
}

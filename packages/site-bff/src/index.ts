import "server-only"

import { randomUUID } from "node:crypto"

import {
  bootstrapSiteRuntimeFromOpaqueSession,
  createOriginCsrfBrowserRequestVerifier,
  createSessionBrowserV3Proxy,
  createSessionBrowserV3Transport,
  loadSiteDeploymentBinding,
  ProductContextManager,
  SessionAccessManager,
  type OpaqueAuthSession,
  type PublicSiteBootstrap,
  type SiteBootstrap,
  type SiteDeploymentBinding,
  publicSiteBootstrap,
} from "@kokoro/bff-runtime"
import {
  createPlatformPublicClient,
  type PublicCommandContext,
  type SecretPublicCommandContext,
  type PlatformPublicTransport,
} from "@kokoro/site-client/server"
import type {
  AccountProductsResponse,
  CommandReceiptResponse,
  CreditSummaryResponse,
  EmailVerificationTransactionResponse,
  IdentitySessionList,
  PublicCommandReceiptResponse,
  ReauthenticationResponse,
  RecoveryCodeSetResponse,
  RedemptionCommandResponse,
  RedemptionPreviewResponse,
  TotpEnrollmentTransactionResponse,
  VerificationActivationResponse,
} from "@kokoro/site-client"
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node"

export { createLaunchStateVault } from "./launch-state.js"
export type { LaunchCommandState, LaunchOperation, LaunchStateBinding, LaunchStateVault, SecurityLaunchState } from "./launch-state.js"
export { createSiteLaunchApi, SITE_LAUNCH_STATE_COOKIE } from "./launch-api.js"
export type { SiteLaunchApi } from "./launch-api.js"

export class SiteBffError extends Error {
  constructor(readonly code: "CONFIG_INVALID" | "AUTH_REJECTED" | "AUTH_MFA_REQUIRED" | "AUTH_DELIVERY_UNAVAILABLE") {
    super(`Site BFF rejected: ${code}`)
    this.name = "SiteBffError"
  }
}

export type SiteCredentialPair = Readonly<{
  sessionRef: string
  sessionCredential: string
  sessionCredentialExpiresAt: string
  refreshCredential: string
  refreshCredentialExpiresAt: string
}>

export type SiteLoginResult =
  | Readonly<{ kind: "authenticated"; credentials: SiteCredentialPair }>
  | Readonly<{ kind: "mfa_required"; transactionRef: string; challengeKind: "totp" | "recovery"; expiresAt: string }>

export type SiteOneTimeCommand = Readonly<SecretPublicCommandContext>
export type SiteDeliveryAttempt = Readonly<{
  command: SiteOneTimeCommand
  priorCommandId?: string
}>

export type SiteReauthenticationTarget = Readonly<{
  audience: "platform-public"
  operationId: "beginTotpEnrollment" | "disableTotp" | "regenerateRecoveryCodes"
  resource: Readonly<{ kind: "identity_account" }>
}>

export type SiteReauthenticationInput =
  | Readonly<{ stage: "password"; password: string; target: SiteReauthenticationTarget }>
  | Readonly<{
      stage: "mfa"
      challengeKind: "totp" | "recovery"
      proofCode: string
      transactionRef: string
      target: SiteReauthenticationTarget
    }>

/** A superseding delivery consumes the prior command and its recovery capability atomically. */
export function supersedeSiteDelivery(
  prior: SiteDeliveryAttempt,
  fresh: SiteOneTimeCommand,
): SiteDeliveryAttempt {
  return Object.freeze({
    command: Object.freeze({
      ...fresh,
      receiptRecoveryCapability: prior.command.receiptRecoveryCapability,
    }),
    priorCommandId: prior.command.commandId,
  })
}

export type SiteSessionRuntime = Readonly<{
  authSession: Readonly<import("@kokoro/bff-runtime").AuthSession>
  bootstrap: SiteBootstrap
  publicBootstrap: Readonly<PublicSiteBootstrap>
  proxy: ReturnType<typeof createSessionBrowserV3Proxy>
}>

export interface SiteBffRuntime {
  readonly publicOrigin: string
  readonly deploymentIdentity: Readonly<{ deploymentRef: string; webArtifactDigest: string; publicOrigin: string }>
  readonly bindingIdentity: Readonly<{ siteProjectBindingRef: string; siteReleaseRef: string }>
  issueBrowserCsrf(): string
  verifyBrowserMutation(input: Readonly<{ operationId: string; token: string }>): boolean
  createCommand(): PublicCommandContext
  createOneTimeCommand(): SiteOneTimeCommand
  publicCapabilities(): Promise<Readonly<{ enabledSurfaceIds: readonly string[]; featurePolicyRevision: string }>>
  register(input: Readonly<{ email: string; password: string; legalAcceptanceRefs: readonly string[] }>, command: PublicCommandContext): Promise<EmailVerificationTransactionResponse>
  resendVerification(email: string, command: PublicCommandContext): Promise<EmailVerificationTransactionResponse>
  completeEmailVerification(input: Readonly<{ transactionRef: string; transactionSecret: string }>, delivery: SiteDeliveryAttempt): Promise<VerificationActivationResponse>
  listSecuritySessions(auth: OpaqueAuthSession): Promise<IdentitySessionList>
  reauthenticate(auth: OpaqueAuthSession, input: SiteReauthenticationInput, delivery: SiteDeliveryAttempt): Promise<ReauthenticationResponse>
  beginTotpEnrollment(auth: OpaqueAuthSession, input: Readonly<{ reauthenticationProof: string; priorTransactionRef?: string }>, delivery: SiteDeliveryAttempt): Promise<TotpEnrollmentTransactionResponse>
  confirmTotpEnrollment(auth: OpaqueAuthSession, input: Readonly<{ transactionRef: string; code: string }>, delivery: SiteDeliveryAttempt): Promise<RecoveryCodeSetResponse>
  disableTotp(auth: OpaqueAuthSession, input: Readonly<{ reauthenticationProof: string; code: string }>, command: PublicCommandContext): Promise<CommandReceiptResponse>
  regenerateRecoveryCodes(auth: OpaqueAuthSession, input: Readonly<{ reauthenticationProof: string }>, delivery: SiteDeliveryAttempt): Promise<RecoveryCodeSetResponse>
  revokeSessions(auth: OpaqueAuthSession, input: Readonly<{ target: "current" | "others" | "all" }>, command: PublicCommandContext): Promise<CommandReceiptResponse>
  previewRedemption(auth: OpaqueAuthSession, code: string, command: PublicCommandContext): Promise<RedemptionPreviewResponse>
  confirmRedemption(auth: OpaqueAuthSession, input: Readonly<{ previewCredential: string; legalAcceptanceRefs: readonly string[] }>, command: PublicCommandContext): Promise<RedemptionCommandResponse>
  recoverRedemption(auth: OpaqueAuthSession, idempotencyKey: string): Promise<RedemptionCommandResponse>
  accountProducts(auth: OpaqueAuthSession): Promise<AccountProductsResponse>
  creditSummary(auth: OpaqueAuthSession): Promise<CreditSummaryResponse>
  commandReceipt(auth: OpaqueAuthSession | null, commandId: string, receiptRecoveryCapability?: string): Promise<PublicCommandReceiptResponse>
  login(input: Readonly<{ email: string; password: string }>, delivery: SiteDeliveryAttempt): Promise<SiteLoginResult>
  completeMfa(input: Readonly<{ transactionRef: string; code: string }>, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair>
  refresh(refreshCredential: string, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair>
  revoke(auth: OpaqueAuthSession): Promise<void>
  assemble(auth: OpaqueAuthSession): Promise<SiteSessionRuntime>
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new SiteBffError("CONFIG_INVALID")
  return value
}

function fixedOrigin(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new SiteBffError("CONFIG_INVALID")
  }
  if (
    parsed.protocol !== "https:" || parsed.origin !== value || parsed.username !== "" || parsed.password !== "" ||
    parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== ""
  ) throw new SiteBffError("CONFIG_INVALID")
  return parsed.origin
}

export function loadSiteBffDeployment(env: NodeJS.ProcessEnv = process.env): Readonly<{
  binding: SiteDeploymentBinding
  publicOrigin: string
}> {
  const runtimeEnvironment = required(env, "KOKORO_SITE_RUNTIME_ENVIRONMENT")
  if (runtimeEnvironment !== "development" && runtimeEnvironment !== "preview" && runtimeEnvironment !== "production") {
    throw new SiteBffError("CONFIG_INVALID")
  }
  return Object.freeze({
    publicOrigin: fixedOrigin(required(env, "KOKORO_SITE_PUBLIC_ORIGIN")),
    binding: loadSiteDeploymentBinding({
      runtimeEnvironment,
      siteProjectBindingRef: required(env, "KOKORO_SITE_PROJECT_BINDING_REF"),
      deploymentRef: required(env, "KOKORO_SITE_DEPLOYMENT_REF"),
      siteReleaseRef: required(env, "KOKORO_SITE_RELEASE_REF"),
      webArtifactDigest: required(env, "KOKORO_WEB_ARTIFACT_DIGEST"),
      workloadCredential: required(env, "KOKORO_PLATFORM_WORKLOAD_CREDENTIAL"),
      sessionContractRevision: required(env, "KOKORO_SESSION_CONTRACT_REVISION"),
      region: required(env, "KOKORO_SITE_REGION"),
      productAudience: required(env, "KOKORO_PRODUCT_AUDIENCE"),
    }),
  })
}

function credentials(response: unknown): SiteCredentialPair {
  if (typeof response !== "object" || response === null) {
    throw new SiteBffError("AUTH_REJECTED")
  }
  if ("kind" in response && response.kind === "delivery_unavailable") {
    throw new SiteBffError("AUTH_DELIVERY_UNAVAILABLE")
  }
  if (!("credentials" in response)) throw new SiteBffError("AUTH_REJECTED")
  const value = response.credentials
  if (typeof value !== "object" || value === null) throw new SiteBffError("AUTH_REJECTED")
  const candidate = value as Record<string, unknown>
  for (const name of [
    "sessionRef",
    "sessionCredential",
    "sessionCredentialExpiresAt",
    "refreshCredential",
    "refreshCredentialExpiresAt",
  ] as const) {
    if (typeof candidate[name] !== "string") throw new SiteBffError("AUTH_REJECTED")
  }
  return Object.freeze(candidate as SiteCredentialPair)
}

function command(client: ReturnType<typeof createPlatformPublicClient>) {
  return client.createCommand()
}

function oneTimeCommand(client: ReturnType<typeof createPlatformPublicClient>): SiteOneTimeCommand {
  return client.createSecretCommand()
}

/** One immutable Site composition root. No request field can replace binding, origin, or provider. */
export function createSiteBffRuntime(input: Readonly<{
  binding: SiteDeploymentBinding
  publicOrigin: string
  provider: NodeSiteRuntimeProvider
}>): SiteBffRuntime {
  const publicOrigin = fixedOrigin(input.publicOrigin)
  const anonymousPlatform = createPlatformPublicClient({
    transport: input.provider.platformTransport({ binding: input.binding }),
    csrfToken: () => input.provider.platformCsrfToken(),
  })
  const productContexts = new ProductContextManager({
    binding: input.binding,
    commandFactory: { create: () => ({ commandRef: randomUUID(), ...command(anonymousPlatform) }) },
    authority: {
      exchangeProductContext: ({ commandRef, command: commandIdentity }) => anonymousPlatform.execute({
        operationId: "exchangeProductContext",
        data: { body: { commandRef } },
        command: commandIdentity,
      }),
    },
  })

  const authenticatedClient = (authSession: OpaqueAuthSession) => createPlatformPublicClient({
    transport: input.provider.platformTransport({ binding: input.binding, authSession }),
    csrfToken: () => input.provider.platformCsrfToken(),
  })

  return Object.freeze({
    publicOrigin,
    deploymentIdentity: Object.freeze({
      deploymentRef: input.binding.deploymentRef,
      webArtifactDigest: input.binding.webArtifactDigest,
      publicOrigin,
    }),
    bindingIdentity: Object.freeze({
      siteProjectBindingRef: input.binding.siteProjectBindingRef,
      siteReleaseRef: input.binding.siteReleaseRef,
    }),
    issueBrowserCsrf: () => input.provider.issueBrowserCsrf(),
    verifyBrowserMutation: (verification: Readonly<{ operationId: string; token: string }>) =>
      input.provider.verifyBrowserCsrf(verification),
    createCommand: () => command(anonymousPlatform),
    createOneTimeCommand: () => oneTimeCommand(anonymousPlatform),
    async publicCapabilities(): Promise<Readonly<{ enabledSurfaceIds: readonly string[]; featurePolicyRevision: string }>> {
      const context = await productContexts.acquire()
      return Object.freeze({
        enabledSurfaceIds: Object.freeze([...context.enabledSurfaceIds]),
        featurePolicyRevision: context.featurePolicyRevision,
      })
    },
    register(
      registration: Readonly<{ email: string; password: string; legalAcceptanceRefs: readonly string[] }>,
      commandIdentity: ReturnType<typeof command>,
    ) {
      return anonymousPlatform.execute({
        operationId: "beginRegistration",
        data: { body: {
          email: registration.email.trim().toLowerCase(),
          password: registration.password,
          legalAcceptanceRefs: [...registration.legalAcceptanceRefs],
        } },
        command: commandIdentity,
      })
    },
    resendVerification(email: string, commandIdentity: ReturnType<typeof command>) {
      return anonymousPlatform.execute({
        operationId: "resendEmailVerification",
        data: { body: { email: email.trim().toLowerCase() } },
        command: commandIdentity,
      })
    },
    completeEmailVerification(
      verification: Readonly<{ transactionRef: string; transactionSecret: string }>,
      delivery: SiteDeliveryAttempt,
    ) {
      return anonymousPlatform.execute({
        operationId: "completeEmailVerification",
        data: { path: { id: verification.transactionRef }, body: { transactionSecret: verification.transactionSecret } },
        command: delivery.command,
      })
    },
    listSecuritySessions(authSession: OpaqueAuthSession) {
      return authenticatedClient(authSession).execute({ operationId: "listIdentitySessions", data: {} })
    },
    reauthenticate(
      authSession: OpaqueAuthSession,
      reauthentication: SiteReauthenticationInput,
      delivery: SiteDeliveryAttempt,
    ) {
      return authenticatedClient(authSession).execute({
        operationId: "reauthenticateIdentitySession",
        data: { body: delivery.priorCommandId === undefined
          ? reauthentication
          : { stage: "supersede", priorCommandId: delivery.priorCommandId } },
        command: delivery.command,
      })
    },
    beginTotpEnrollment(
      authSession: OpaqueAuthSession,
      enrollment: Readonly<{ reauthenticationProof: string; priorTransactionRef?: string }>,
      delivery: SiteDeliveryAttempt,
    ) {
      if (delivery.priorCommandId !== undefined && enrollment.priorTransactionRef === undefined) {
        throw new TypeError("superseding TOTP enrollment requires the prior transaction")
      }
      return authenticatedClient(authSession).execute({
        operationId: "beginTotpEnrollment",
        data: { body: delivery.priorCommandId === undefined
          ? { ceremonyAction: "begin", reauthenticationProof: enrollment.reauthenticationProof }
          : { ceremonyAction: "supersede", priorCommandId: delivery.priorCommandId,
              priorTransactionRef: enrollment.priorTransactionRef as string } },
        command: delivery.command,
      })
    },
    confirmTotpEnrollment(
      authSession: OpaqueAuthSession,
      confirmation: Readonly<{ transactionRef: string; code: string }>,
      delivery: SiteDeliveryAttempt,
    ) {
      if (delivery.priorCommandId !== undefined) {
        throw new TypeError("TOTP confirmation has no secret-delivery supersede operation")
      }
      return authenticatedClient(authSession).execute({
        operationId: "confirmTotpEnrollment",
        data: { body: confirmation },
        command: delivery.command,
      })
    },
    disableTotp(
      authSession: OpaqueAuthSession,
      disable: Readonly<{ reauthenticationProof: string; code: string }>,
      commandIdentity: PublicCommandContext,
    ) {
      return authenticatedClient(authSession).execute({
        operationId: "disableTotp",
        data: { body: disable },
        command: commandIdentity,
      })
    },
    regenerateRecoveryCodes(
      authSession: OpaqueAuthSession,
      regeneration: Readonly<{ reauthenticationProof: string }>,
      delivery: SiteDeliveryAttempt,
    ) {
      return authenticatedClient(authSession).execute({
        operationId: "regenerateRecoveryCodes",
        data: { body: delivery.priorCommandId === undefined
          ? { recoveryAction: "regenerate", reauthenticationProof: regeneration.reauthenticationProof }
          : { recoveryAction: "supersede", priorCommandId: delivery.priorCommandId } },
        command: delivery.command,
      })
    },
    revokeSessions(
      authSession: OpaqueAuthSession,
      revoke: Readonly<{ target: "current" | "others" | "all" }>,
      commandIdentity: ReturnType<typeof command>,
    ) {
      return authenticatedClient(authSession).execute({
        operationId: "revokeIdentitySessions",
        data: { body: revoke },
        command: commandIdentity,
      })
    },
    previewRedemption(authSession: OpaqueAuthSession, code: string, commandIdentity: ReturnType<typeof command>) {
      return authenticatedClient(authSession).execute({
        operationId: "previewRedemption",
        data: { body: { code } },
        command: commandIdentity,
      })
    },
    confirmRedemption(
      authSession: OpaqueAuthSession,
      redemption: Readonly<{ previewCredential: string; legalAcceptanceRefs: readonly string[] }>,
      commandIdentity: ReturnType<typeof command>,
    ) {
      return authenticatedClient(authSession).execute({
        operationId: "confirmRedemption",
        data: { body: {
          previewCredential: redemption.previewCredential,
          legalAcceptanceRefs: [...redemption.legalAcceptanceRefs],
        } },
        command: commandIdentity,
      })
    },
    recoverRedemption(authSession: OpaqueAuthSession, idempotencyKey: string) {
      return authenticatedClient(authSession).execute({
        operationId: "recoverRedemptionCommand",
        data: {},
        idempotencyKey,
      })
    },
    accountProducts(authSession: OpaqueAuthSession) {
      return authenticatedClient(authSession).execute({ operationId: "listAccountProducts", data: {} })
    },
    creditSummary(authSession: OpaqueAuthSession) {
      return authenticatedClient(authSession).execute({ operationId: "getCreditSummary", data: {} })
    },
    commandReceipt(authSession: OpaqueAuthSession | null, commandId: string, receiptRecoveryCapability?: string) {
      const platform = authSession === null ? anonymousPlatform : authenticatedClient(authSession)
      return platform.execute({
        operationId: "getPublicCommandReceipt",
        data: { path: { id: commandId } },
        ...(receiptRecoveryCapability === undefined ? {} : { receiptRecoveryCapability }),
      })
    },
    async login(
      loginInput: Readonly<{ email: string; password: string }>,
      delivery: SiteDeliveryAttempt,
    ): Promise<SiteLoginResult> {
      const response = await anonymousPlatform.execute({
        operationId: "createIdentitySession",
        data: { body: delivery.priorCommandId === undefined
          ? { email: loginInput.email.trim().toLowerCase(), password: loginInput.password }
          : { priorCommandId: delivery.priorCommandId, recoveryAction: "supersede_session_delivery" } },
        command: delivery.command,
      })
      if ("pending" in response) {
        return Object.freeze({ kind: "mfa_required", ...response.pending })
      }
      return Object.freeze({ kind: "authenticated", credentials: credentials(response) })
    },
    async completeMfa(
      mfa: Readonly<{ transactionRef: string; code: string }>,
      delivery: SiteDeliveryAttempt,
    ): Promise<SiteCredentialPair> {
      const response = await anonymousPlatform.execute({
        operationId: "completeSessionMfa",
        data: {
          path: { id: mfa.transactionRef },
          body: delivery.priorCommandId === undefined
            ? { code: mfa.code }
            : { priorCommandId: delivery.priorCommandId, recoveryAction: "supersede_session_delivery" },
        },
        command: delivery.command,
      })
      return credentials(response)
    },
    async refresh(refreshCredential: string, delivery: SiteDeliveryAttempt): Promise<SiteCredentialPair> {
      const response = await anonymousPlatform.execute({
        operationId: "refreshIdentitySession",
        data: { body: delivery.priorCommandId === undefined
          ? { opaqueCredential: refreshCredential }
          : { priorCommandId: delivery.priorCommandId, recoveryAction: "supersede_refresh_delivery" } },
        command: delivery.command,
      })
      return credentials(response)
    },
    async revoke(authSession: OpaqueAuthSession): Promise<void> {
      const platform = authenticatedClient(authSession)
      await platform.execute({
        operationId: "revokeIdentitySessions",
        data: { body: { target: "current" } },
        command: command(platform),
      })
    },
    async assemble(authSession: OpaqueAuthSession): Promise<SiteSessionRuntime> {
      const platform = authenticatedClient(authSession)
      const resolved = await bootstrapSiteRuntimeFromOpaqueSession({
        productContexts,
        authSession,
        personalAuthority: {
          getPersonalContext: () => platform.execute({ operationId: "getPersonalContext", data: {} }),
        },
      })
      const access = new SessionAccessManager({
        bootstrap: resolved.bootstrap,
        authSession: resolved.authSession,
        authority: {
          issueSessionAccessGrant: ({ productContextRef, projectRef, purpose, resource }) => platform.execute({
            operationId: "issueSessionAccessGrant",
            data: { body: { productContextRef, projectRef, purpose, resource } },
          }),
        },
      })
      return Object.freeze({
        ...resolved,
        publicBootstrap: publicSiteBootstrap(resolved.bootstrap),
        proxy: createSessionBrowserV3Proxy({
          bootstrap: resolved.bootstrap,
          access,
          transport: createSessionBrowserV3Transport(input.provider.sessionHttp({ binding: input.binding })),
          browserRequestVerifier: createOriginCsrfBrowserRequestVerifier({
            runtimeEnvironment: input.binding.runtimeEnvironment,
            allowedOrigins: [publicOrigin],
            csrf: { verify: (request) => input.provider.verifyBrowserCsrf(request) },
          }),
        }),
      })
    },
  })
}

export type { OpaqueAuthSession } from "@kokoro/bff-runtime"
export type { PlatformPublicTransport }

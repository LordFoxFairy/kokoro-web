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
  type SecretPublicCommandContext,
  type PlatformPublicTransport,
} from "@kokoro/site-client/server"
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node"

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

export type SiteSessionRuntime = Readonly<{
  authSession: Readonly<import("@kokoro/bff-runtime").AuthSession>
  bootstrap: SiteBootstrap
  publicBootstrap: Readonly<PublicSiteBootstrap>
  proxy: ReturnType<typeof createSessionBrowserV3Proxy>
}>

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
}>) {
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
    issueBrowserCsrf: () => input.provider.issueBrowserCsrf(),
    createOneTimeCommand: () => oneTimeCommand(anonymousPlatform),
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

export type SiteBffRuntime = ReturnType<typeof createSiteBffRuntime>
export type { OpaqueAuthSession } from "@kokoro/bff-runtime"
export type { PlatformPublicTransport }

import "server-only"

import { randomUUID } from "node:crypto"

import {
  bootstrapSiteRuntime,
  createOriginCsrfBrowserRequestVerifier,
  createSessionBrowserV3Proxy,
  createSessionBrowserV3Transport,
  loadSiteDeploymentBinding,
  ProductContextManager,
  SessionAccessManager,
  type AuthenticatedSessionBrowserV3HttpPort,
  type AuthSession,
  type SiteDeploymentBinding,
} from "@kokoro/bff-runtime"
import {
  createPlatformPublicClient,
  type PlatformPublicTransport,
} from "@kokoro/site-client/server"

import { SESSION_COOKIE } from "./auth"
import { openEnvelope } from "./session-envelope"

export class SessionV3AssemblyError extends Error {
  constructor(readonly code: "PLATFORM_UNAVAILABLE" | "SESSION_UNAVAILABLE" | "DEPLOYMENT_INVALID") {
    super(`Session browser v3 unavailable: ${code}`)
    this.name = "SessionV3AssemblyError"
  }
}

/** Registered transports own mTLS/endpoints. Raw Platform or Session URLs are deliberately absent. */
export interface RegisteredSessionV3Provider {
  platformTransport(input: Readonly<{
    binding: SiteDeploymentBinding
    authSession?: AuthSession
  }>): PlatformPublicTransport
  sessionHttp: AuthenticatedSessionBrowserV3HttpPort
  platformCsrfToken(): string
  issueBrowserCsrf(): string
  verifyBrowserCsrf(input: Readonly<{ operationId: string; token: string }>): Promise<boolean> | boolean
}

let provider: RegisteredSessionV3Provider | undefined
let compositionInitialized = false

type SessionRuntime = Awaited<ReturnType<typeof createSessionRuntime>>
type DeploymentRuntime = Readonly<{
  fingerprint: string
  provider: RegisteredSessionV3Provider
  productContexts: ProductContextManager
}>
type CachedSessionRuntime = Readonly<{
  authCredential: string
  authExpiresAt: number
  bootstrapExpiresAt: number
  runtime: SessionRuntime
}>

let deploymentRuntime: DeploymentRuntime | undefined
const sessionRuntimes = new Map<string, CachedSessionRuntime>()
const MAX_SESSION_RUNTIMES = 256

/** Composition-root hook. A provider may be installed once; request data can never replace it. */
export function registerSessionV3Provider(value: RegisteredSessionV3Provider): void {
  if (provider !== undefined && provider !== value) throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  provider = Object.freeze(value)
}

/** Called by Next instrumentation even when the separately deployed provider is unavailable. */
export function initializeSessionV3ProductionComposition(): void {
  compositionInitialized = true
}

export function issueSessionV3BrowserCsrf(): string | undefined {
  return compositionInitialized ? provider?.issueBrowserCsrf() : undefined
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  return value
}

export function sessionV3PublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = required(env, "KOKORO_SITE_PUBLIC_ORIGIN")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  }
  if (url.origin !== value || url.username !== "" || url.password !== "") {
    throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  }
  return value
}

function cookie(request: Request, name: string): string | null {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = item.indexOf("=")
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(item.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

export function platformAuthSessionFromRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): AuthSession | null {
  const secretRaw = required(env, "KOKORO_WEB_SESSION_SECRET")
  const secrets = secretRaw.split(",").map((value) => value.trim()).filter(Boolean)
  const sealed = cookie(request, SESSION_COOKIE)
  if (sealed === null || secrets.length === 0) return null
  const envelope = openEnvelope(sealed, secrets, Math.floor(Date.now() / 1_000))
  const session = envelope?.platform_session
  return session === undefined ? null : Object.freeze({
    sessionRef: session.session_ref,
    sessionCredential: session.session_credential,
    subjectRef: session.subject_ref,
    subjectGeneration: session.subject_generation,
    expiresAt: session.expires_at,
  })
}

function deploymentBinding(env: NodeJS.ProcessEnv): SiteDeploymentBinding {
  const runtimeEnvironment = required(env, "KOKORO_SITE_RUNTIME_ENVIRONMENT")
  if (!(["development", "preview", "production"] as const).includes(
    runtimeEnvironment as "development" | "preview" | "production",
  )) throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  try {
    return loadSiteDeploymentBinding({
      runtimeEnvironment: runtimeEnvironment as "development" | "preview" | "production",
      siteProjectBindingRef: required(env, "KOKORO_SITE_PROJECT_BINDING_REF"),
      deploymentRef: required(env, "KOKORO_SITE_DEPLOYMENT_REF"),
      siteReleaseRef: required(env, "KOKORO_SITE_RELEASE_REF"),
      webArtifactDigest: required(env, "KOKORO_WEB_ARTIFACT_DIGEST"),
      workloadCredential: required(env, "KOKORO_PLATFORM_WORKLOAD_CREDENTIAL"),
      sessionContractRevision: required(env, "KOKORO_SESSION_CONTRACT_REVISION"),
      region: required(env, "KOKORO_SITE_REGION"),
      productAudience: required(env, "KOKORO_PRODUCT_AUDIENCE"),
    })
  } catch {
    throw new SessionV3AssemblyError("DEPLOYMENT_INVALID")
  }
}

export async function assembleSessionBrowserV3(input: Readonly<{
  authSession: AuthSession
  env?: NodeJS.ProcessEnv
}>) {
  if (!compositionInitialized) throw new SessionV3AssemblyError("PLATFORM_UNAVAILABLE")
  const activeProvider = provider
  if (activeProvider === undefined) throw new SessionV3AssemblyError("PLATFORM_UNAVAILABLE")
  const binding = deploymentBinding(input.env ?? process.env)
  const allowedOrigin = sessionV3PublicOrigin(input.env ?? process.env)
  const fingerprint = JSON.stringify(binding)
  if (
    deploymentRuntime === undefined ||
    deploymentRuntime.fingerprint !== fingerprint ||
    deploymentRuntime.provider !== activeProvider
  ) {
    const productPlatform = createPlatformPublicClient({
      transport: activeProvider.platformTransport({ binding }),
      csrfToken: () => activeProvider.platformCsrfToken(),
    })
    deploymentRuntime = Object.freeze({
      fingerprint,
      provider: activeProvider,
      productContexts: new ProductContextManager({
        binding,
        commandFactory: {
          create: () => ({ commandRef: randomUUID(), ...productPlatform.createCommand() }),
        },
        authority: {
          exchangeProductContext: ({ commandRef, command }) => productPlatform.execute({
            operationId: "exchangeProductContext",
            data: { body: { commandRef } },
            command,
          }),
        },
      }),
    })
    sessionRuntimes.clear()
  }
  const now = Date.now()
  for (const [key, cached] of sessionRuntimes) {
    if (cached.authExpiresAt <= now || cached.bootstrapExpiresAt <= now) sessionRuntimes.delete(key)
  }
  const cacheKey = `${input.authSession.sessionRef}\u0000${input.authSession.subjectGeneration}`
  const cached = sessionRuntimes.get(cacheKey)
  if (
    cached !== undefined &&
    cached.authCredential === input.authSession.sessionCredential &&
    cached.authExpiresAt === Date.parse(input.authSession.expiresAt)
  ) {
    sessionRuntimes.delete(cacheKey)
    sessionRuntimes.set(cacheKey, cached)
    return cached.runtime
  }
  sessionRuntimes.delete(cacheKey)
  const runtime = await createSessionRuntime({
    activeProvider,
    binding,
    authSession: input.authSession,
    allowedOrigin,
    productContexts: deploymentRuntime.productContexts,
  })
  sessionRuntimes.set(cacheKey, Object.freeze({
    authCredential: input.authSession.sessionCredential,
    authExpiresAt: Date.parse(input.authSession.expiresAt),
    bootstrapExpiresAt: Date.parse(runtime.bootstrap.expiresAt),
    runtime,
  }))
  while (sessionRuntimes.size > MAX_SESSION_RUNTIMES) {
    const oldest = sessionRuntimes.keys().next().value as string | undefined
    if (oldest === undefined) break
    sessionRuntimes.delete(oldest)
  }
  return runtime
}

async function createSessionRuntime(input: Readonly<{
  activeProvider: RegisteredSessionV3Provider
  binding: SiteDeploymentBinding
  authSession: AuthSession
  allowedOrigin: string
  productContexts: ProductContextManager
}>) {
  const platform = createPlatformPublicClient({
    transport: input.activeProvider.platformTransport({ binding: input.binding, authSession: input.authSession }),
    csrfToken: () => input.activeProvider.platformCsrfToken(),
  })
  const bootstrap = await bootstrapSiteRuntime({
    productContexts: input.productContexts,
    authSession: input.authSession,
    personalAuthority: {
      getPersonalContext: () => platform.execute({ operationId: "getPersonalContext", data: {} }),
    },
  })
  const access = new SessionAccessManager({
    bootstrap,
    authSession: input.authSession,
    authority: {
      issueSessionAccessGrant: ({ productContextRef, projectRef, purpose, resource }) => platform.execute({
        operationId: "issueSessionAccessGrant",
        data: { body: { productContextRef, projectRef, purpose, resource } },
      }),
    },
  })
  return Object.freeze({
    bootstrap,
    proxy: createSessionBrowserV3Proxy({
      bootstrap,
      access,
      transport: createSessionBrowserV3Transport(input.activeProvider.sessionHttp),
      browserRequestVerifier: createOriginCsrfBrowserRequestVerifier({
        runtimeEnvironment: input.binding.runtimeEnvironment,
        allowedOrigins: [input.allowedOrigin],
        csrf: { verify: (request) => input.activeProvider.verifyBrowserCsrf(request) },
      }),
    }),
  })
}

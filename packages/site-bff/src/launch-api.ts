import "server-only"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"
import { PlatformPublicError } from "@kokoro/site-client/server"

import type { SiteBffRuntime, SiteOneTimeCommand, SiteReauthenticationTarget } from "./index.js"
import {
  createLaunchStateVault,
  SITE_LAUNCH_OPERATIONS,
  type LaunchCommandState,
  type LaunchOperation,
} from "./launch-state.js"
import type { SiteLegalDocument } from "./site-legal-documents.js"

export const SITE_LAUNCH_STATE_COOKIE = "__Host-kokoro.launch-state"
const STATE_TTL_MS = 15 * 60 * 1_000
const MAXIMUM_BODY_BYTES = 16_384
const COOKIE_CHUNK_BYTES = 3_500
const MAXIMUM_COOKIE_CHUNKS = 4
const FLOW_REF = /^[A-Za-z0-9_-]{16,96}$/u
const POST_ACTIONS = new Set(["prepare", "execute", "recover"])
const EXACT_RETRY_REQUIRED = Symbol("site-launch-exact-retry-required")

type LaunchAction = "dashboard" | "prepare" | "execute" | "recover"

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=")
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try { return decodeURIComponent(part.slice(separator + 1).trim()) } catch { return null }
  }
  return null
}

function stateCookie(request: Request): string | null {
  const first = cookie(request, SITE_LAUNCH_STATE_COOKIE)
  if (first === null) return null
  let value = first
  for (let index = 1; index < MAXIMUM_COOKIE_CHUNKS; index += 1) {
    const chunk = cookie(request, `${SITE_LAUNCH_STATE_COOKIE}.${index}`)
    if (chunk === null) break
    value += chunk
  }
  return value
}

function setState(response: Response, value: string): Response {
  const chunks = Array.from({ length: Math.ceil(value.length / COOKIE_CHUNK_BYTES) }, (_, index) =>
    value.slice(index * COOKIE_CHUNK_BYTES, (index + 1) * COOKIE_CHUNK_BYTES))
  if (chunks.length > MAXIMUM_COOKIE_CHUNKS) throw new Error("launch state exceeds bounded cookie envelope")
  for (let index = 0; index < MAXIMUM_COOKIE_CHUNKS; index += 1) {
    const name = index === 0 ? SITE_LAUNCH_STATE_COOKIE : `${SITE_LAUNCH_STATE_COOKIE}.${index}`
    const chunk = chunks[index]
    response.headers.append("set-cookie", `${name}=${chunk === undefined ? "" : encodeURIComponent(chunk)}; Max-Age=${chunk === undefined ? 0 : 900}; Path=/; HttpOnly; Secure; SameSite=Strict`)
  }
  response.headers.set("cache-control", "no-store")
  return response
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

function unavailable(status = 503): Response {
  return json({ state: "unavailable", retry: status >= 500 ? "later" : "after_user_action" }, status)
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_BODY_BYTES)) {
    await request.body?.cancel("request body exceeds the bounded JSON envelope").catch(() => undefined)
    throw new Error("invalid")
  }
  if (request.body === null) throw new Error("invalid")

  const reader = request.body.getReader()
  const envelope = new Uint8Array(MAXIMUM_BODY_BYTES)
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (length + next.value.byteLength > MAXIMUM_BODY_BYTES) {
        await reader.cancel("request body exceeds the bounded JSON envelope").catch(() => undefined)
        throw new Error("invalid")
      }
      envelope.set(next.value, length)
      length += next.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (length < 2) throw new Error("invalid")
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelope.subarray(0, length))) as unknown
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid")
  return value as Record<string, unknown>
}

function text(value: unknown, minimum: number, maximum: number): string | null {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum ? value : null
}

function operation(value: unknown): LaunchOperation | null {
  return typeof value === "string" && [
    "identity.register", "identity.verify-email", "identity.resend-verification",
    "identity.revoke-sessions", "identity.enroll-totp", "identity.disable-totp",
    "identity.regenerate-recovery-codes", "redemption.preview", "redemption.confirm",
  ].includes(value) ? value as LaunchOperation : null
}

function flow(value: unknown): string | null {
  return typeof value === "string" && FLOW_REF.test(value) ? value : null
}

function authRequired(value: LaunchOperation): boolean {
  return value.startsWith("redemption.") || [
    "identity.revoke-sessions", "identity.enroll-totp", "identity.disable-totp",
    "identity.regenerate-recovery-codes",
  ].includes(value)
}

function securityTarget(operationId: LaunchOperation): SiteReauthenticationTarget | null {
  const targetOperation = operationId === "identity.enroll-totp"
    ? "beginTotpEnrollment"
    : operationId === "identity.disable-totp"
      ? "disableTotp"
      : operationId === "identity.regenerate-recovery-codes"
        ? "regenerateRecoveryCodes"
        : null
  return targetOperation === null ? null : Object.freeze({
    audience: "platform-public" as const,
    operationId: targetOperation,
    resource: Object.freeze({ kind: "identity_account" as const }),
  })
}

function secretCommand(command: LaunchCommandState["command"]): SiteOneTimeCommand | null {
  return "receiptRecoveryCapability" in command ? command as SiteOneTimeCommand : null
}

function ceremonyExpiresAt(now: number, upstreamExpiresAt: string): number {
  const upstream = Date.parse(upstreamExpiresAt)
  return Number.isFinite(upstream) ? Math.min(now + STATE_TTL_MS, upstream) : now
}

function publicPreview(
  response: Awaited<ReturnType<SiteBffRuntime["previewRedemption"]>>,
  legalDocuments: readonly SiteLegalDocument[],
) {
  const byRef = new Map(legalDocuments.map((document) => [document.termRef, document]))
  const previewDocuments = response.preview.legalTermRefs.map((termRef) => {
    const document = byRef.get(termRef)
    if (document === undefined) throw new Error("Redemption references an unpublished Site legal document")
    return { label: document.label, href: document.href }
  })
  return Object.freeze({
    state: "ready" as const,
    product: response.preview.safeProductLabel,
    plan: response.preview.safePlanLabel,
    kind: response.preview.productKind,
    expiresAt: response.preview.expiresAt,
    term: response.preview.term,
    entitlements: response.preview.entitlements.map(({ safeLabel, expiresAt }) => ({ safeLabel, expiresAt })),
    credits: response.preview.credits.map(({ amount, unit, bucketClass, expiresAt }) => ({ amount, unit, bucketClass, expiresAt })),
    legalAcceptanceRequired: response.preview.legalTermRefs.length > 0,
    legalDocuments: previewDocuments,
  })
}

function publicRedemption(response: Awaited<ReturnType<SiteBffRuntime["confirmRedemption"]>>) {
  if (response.kind === "succeeded") return {
    state: "succeeded" as const,
    productState: response.redemption.state,
    redeemedAt: response.redemption.redeemedAt,
  }
  if (response.kind === "rejected") return {
    state: "rejected" as const,
    retry: response.rejection.retryClass,
  }
  if (response.kind === "review_required") return {
    state: "review_required" as const,
    expiresAt: response.reviewExpiresAt,
  }
  return { state: response.kind, retryAfter: response.retryAfter }
}

function publicReceipt(response: Awaited<ReturnType<SiteBffRuntime["commandReceipt"]>>) {
  if (response.reconciliation.kind === "terminal") return {
    state: response.reconciliation.outcome,
  }
  if (response.reconciliation.kind === "superseding_ceremony_required") return {
    state: "recovery_required" as const,
    expiresAt: response.reconciliation.ceremony.expiresAt,
  }
  return { state: "pending" as const, retryAfterSeconds: response.reconciliation.retryAfterSeconds }
}

export function createSiteLaunchApi(input: Readonly<{
  runtime: SiteBffRuntime
  stateSecret: string
  readAuthSession(request: Request): Promise<OpaqueAuthSession | null> | OpaqueAuthSession | null
  allowedOperations?: readonly LaunchOperation[]
  legalDocuments?: readonly SiteLegalDocument[]
  now?: () => number
  nonce?: () => Buffer
}>) {
  const now = input.now ?? Date.now
  const configuredOperations = input.allowedOperations ?? SITE_LAUNCH_OPERATIONS
  const allowedOperations = new Set<LaunchOperation>(configuredOperations)
  if (
    allowedOperations.size !== configuredOperations.length ||
    configuredOperations.some((candidate) => !SITE_LAUNCH_OPERATIONS.includes(candidate))
  ) throw new TypeError("allowed Site launch operations must be a unique closed set")
  const vault = createLaunchStateVault({
    secret: input.stateSecret,
    binding: {
      ...input.runtime.bindingIdentity,
      deploymentRef: input.runtime.deploymentIdentity.deploymentRef,
      webArtifactDigest: input.runtime.deploymentIdentity.webArtifactDigest,
    },
    now,
    nonce: input.nonce,
  })
  const commandReceipt = async (
    auth: OpaqueAuthSession | null,
    commandId: string,
    receiptRecoveryCapability?: string,
  ) => {
    try {
      return await input.runtime.commandReceipt(auth, commandId, receiptRecoveryCapability)
    } catch (error) {
      if (
        error instanceof PlatformPublicError &&
        error.status === 404 &&
        error.detail.code === "NOT_FOUND"
      ) throw EXACT_RETRY_REQUIRED
      throw error
    }
  }

  async function handle(request: Request, action: LaunchAction): Promise<Response> {
    const mutation = POST_ACTIONS.has(action)
    if (
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      (mutation && (request.method !== "POST" || request.headers.get("origin") !== input.runtime.publicOrigin ||
        !input.runtime.verifyBrowserMutation({ operationId: `site.launch.${action}`, token: request.headers.get("x-kokoro-browser-csrf") ?? "" }))) ||
      (!mutation && request.method !== "GET")
    ) return unavailable(403)

    const entries = vault.open(stateCookie(request))
    const auth = await input.readAuthSession(request)
    try {
      if (action === "dashboard") {
        if (auth === null) return unavailable(401)
        const capabilities = await input.runtime.publicCapabilities()
        const enabled = new Set(capabilities.enabledSurfaceIds)
        const securityEnabled = enabled.has("account") || enabled.has("security")
        const productsEnabled = enabled.has("account") || enabled.has("entitlements")
        const creditsEnabled = enabled.has("credits") || enabled.has("account")
        const [securityResult, productsResult, creditsResult] = await Promise.allSettled([
          securityEnabled ? input.runtime.listSecuritySessions(auth) : Promise.resolve(null),
          productsEnabled ? input.runtime.accountProducts(auth) : Promise.resolve(null),
          creditsEnabled ? input.runtime.creditSummary(auth) : Promise.resolve(null),
        ])
        const security = securityResult.status === "fulfilled" ? securityResult.value : null
        const products = productsResult.status === "fulfilled" ? productsResult.value : null
        const credits = creditsResult.status === "fulfilled" ? creditsResult.value : null
        return json({
          features: {
            security: securityEnabled,
            redemption: enabled.has("redeem") || enabled.has("redemption"),
            products: productsEnabled,
            credits: creditsEnabled,
          },
          availability: {
            security: !securityEnabled ? "disabled" : security === null ? "unavailable" : "available",
            products: !productsEnabled ? "disabled" : products === null ? "unavailable" : "available",
            credits: !creditsEnabled ? "disabled" : credits === null ? "unavailable" : "available",
          },
          sessions: security?.sessions.map(({ current, deviceLabel, createdAt, lastSeenAt, expiresAt, status }) => ({ current, deviceLabel, createdAt, lastSeenAt, expiresAt, status })) ?? [],
          products: products?.products.map(({ safeLabel, kind, state, effectiveAt, expiresAt, plan, entitlements }) => ({
            safeLabel, kind, state, effectiveAt, expiresAt,
            plan: plan === null ? null : { safeLabel: plan.safeLabel, automaticRenewal: plan.automaticRenewal },
            entitlements: entitlements.map(({ safeLabel, state, expiresAt }) => ({ safeLabel, state, expiresAt })),
          })) ?? [],
          credits: credits?.units.map(({ unit, buckets }) => ({
            unit,
            buckets: buckets.map(({ bucketClass, available, held, consumed, expiredOrReversed }) => ({ bucketClass, available, held, consumed, expiredOrReversed })),
          })) ?? [],
          freshness: { products: products?.freshness.state ?? "unavailable", credits: credits?.freshness.state ?? "unavailable" },
        })
      }

      const body = await boundedJson(request)
      const requestedOperation = operation(body.operation)
      const flowRef = flow(body.flowRef)
      if (requestedOperation === null || flowRef === null) return unavailable(400)
      if (!allowedOperations.has(requestedOperation)) return unavailable(404)
      if (authRequired(requestedOperation) && auth === null) return unavailable(401)
      const capabilities = await input.runtime.publicCapabilities()
      const enabled = new Set(capabilities.enabledSurfaceIds)
      const operationEnabled = requestedOperation.startsWith("redemption.")
        ? enabled.has("redeem") || enabled.has("redemption")
        : requestedOperation === "identity.revoke-sessions" || securityTarget(requestedOperation) !== null
          ? enabled.has("account") || enabled.has("security")
          : enabled.has("account") || enabled.has("identity")
      if (!operationEnabled) return unavailable(404)

      if (action === "prepare") {
        const target = securityTarget(requestedOperation)
        const secret = requestedOperation === "identity.verify-email" || target !== null
        const command = secret ? input.runtime.createOneTimeCommand() : input.runtime.createCommand()
        const retained = requestedOperation === "redemption.preview"
          ? entries.filter((entry) => entry.operation !== "redemption.preview")
          : entries
        const next = vault.put(retained, {
          operation: requestedOperation,
          flowRef,
          command,
          createdAt: now(),
          lastUsedAt: now(),
          expiresAt: now() + STATE_TTL_MS,
          ...(target === null ? {} : { security: { phase: "reauthenticate_password" as const } }),
        })
        return setState(new Response(null, { status: 204 }), vault.seal(next))
      }

      const state = vault.find(entries, requestedOperation, flowRef)
      if (state === undefined) return json({ state: "prepare_required" }, 409)
      if (action === "recover") {
        if ([
          "identity.register",
          "identity.resend-verification",
          "identity.disable-totp",
          "identity.revoke-sessions",
          "redemption.preview",
        ].includes(requestedOperation)) {
          // These commands intentionally have no state-read receipt authority. The browser must repeat the
          // exact execute payload against the command already sealed in this flow.
          return json({ state: "exact_retry_required" }, 409)
        }
        if (requestedOperation === "redemption.confirm") {
          const recovered = await input.runtime.recoverRedemption(auth as OpaqueAuthSession, state.command.idempotencyKey)
          return json(publicRedemption(recovered))
        }
        const receiptRecoveryCapability = "receiptRecoveryCapability" in state.command
          ? state.command.receiptRecoveryCapability
          : undefined
        const recovered = await commandReceipt(
          receiptRecoveryCapability === undefined ? auth : null,
          state.command.commandId,
          receiptRecoveryCapability,
        )
        return json(publicReceipt(recovered))
      }

      switch (requestedOperation) {
        case "identity.register": {
          const email = text(body.email, 3, 320)
          const password = text(body.password, 15, 1024)
          const legal = input.legalDocuments?.map(({ termRef }) => termRef) ?? []
          if (email === null || password === null || body.legalAccepted !== true || legal.length === 0) return unavailable(400)
          const response = await input.runtime.register({ email, password, legalAcceptanceRefs: legal }, state.command)
          return json({ state: "verification_pending", deliveryState: response.transaction.deliveryState, expiresAt: response.transaction.expiresAt })
        }
        case "identity.resend-verification": {
          const email = text(body.email, 3, 320)
          if (email === null) return unavailable(400)
          const response = await input.runtime.resendVerification(email, state.command)
          return json({ state: "verification_pending", deliveryState: response.transaction.deliveryState, expiresAt: response.transaction.expiresAt })
        }
        case "identity.verify-email": {
          const transactionRef = text(body.transactionRef, 1, 256)
          const transactionSecret = text(body.transactionSecret, 32, 2048)
          if (transactionRef === null || transactionSecret === null || !("receiptRecoveryCapability" in state.command)) return unavailable(400)
          await input.runtime.completeEmailVerification({ transactionRef, transactionSecret }, { command: state.command })
          return json({ state: "verified" })
        }
        case "identity.revoke-sessions": {
          const target = body.target
          if (target !== "current" && target !== "others" && target !== "all") return unavailable(400)
          await input.runtime.revokeSessions(auth as OpaqueAuthSession, { target }, state.command)
          return json({ state: "committed" })
        }
        case "identity.enroll-totp":
        case "identity.disable-totp":
        case "identity.regenerate-recovery-codes": {
          const target = securityTarget(requestedOperation)
          const command = secretCommand(state.command)
          if (target === null || state.security === undefined) return unavailable(409)

          const finish = (response: Response) => setState(
            response,
            vault.seal(entries.filter((entry) => entry.operation !== requestedOperation || entry.flowRef !== flowRef)),
          )
          const persist = (updated: LaunchCommandState, response: Response) =>
            setState(response, vault.seal(vault.put(entries, updated)))
          const recoveryRecipe = async (
            expectedOperationId: "reauthenticateIdentitySession" | "beginTotpEnrollment" | "regenerateRecoveryCodes",
            priorCommand: SiteOneTimeCommand,
          ) => {
            const receipt = await commandReceipt(
              null,
              priorCommand.commandId,
              priorCommand.receiptRecoveryCapability,
            )
            if (
              receipt.reconciliation.kind !== "superseding_ceremony_required" ||
              receipt.reconciliation.ceremony.operationId !== expectedOperationId
            ) return { receipt, supersede: null }
            const fresh = input.runtime.createOneTimeCommand()
            return {
              receipt,
              supersede: {
                command: Object.freeze({
                  ...fresh,
                  receiptRecoveryCapability: priorCommand.receiptRecoveryCapability,
                }),
                priorCommandId: priorCommand.commandId,
                priorTransactionRef: receipt.reconciliation.ceremony.transactionRef,
              },
            }
          }

          const persistOneTimeUnavailable = (
            updated: LaunchCommandState,
            stateName: "reauthentication_recovery_required" | "enrollment_recovery_required" | "recovery_code_delivery_recovery_required",
          ) => persist(updated, json({ state: stateName, retry: "same_action" }, 202))

          const runEnrollmentDelivery = async (
            security: Readonly<{
              reauthenticationProof: string
              supersedePriorCommandId?: string
              priorTransactionRef?: string
            }>,
            deliveryCommand: SiteOneTimeCommand,
          ): Promise<Response> => {
            let enrolled = await input.runtime.beginTotpEnrollment(
              auth as OpaqueAuthSession,
              security.priorTransactionRef === undefined
                ? { reauthenticationProof: security.reauthenticationProof }
                : { reauthenticationProof: security.reauthenticationProof, priorTransactionRef: security.priorTransactionRef },
              security.supersedePriorCommandId === undefined
                ? { command: deliveryCommand }
                : { command: deliveryCommand, priorCommandId: security.supersedePriorCommandId },
            )
            if (!("transaction" in enrolled)) {
              const recovered = await recoveryRecipe("beginTotpEnrollment", deliveryCommand)
              if (recovered.supersede === null) {
                return recovered.receipt.reconciliation.kind === "pending"
                  ? persistOneTimeUnavailable({ ...state, command: deliveryCommand, lastUsedAt: now(),
                      security: { phase: "totp_enrollment_delivery", ...security } }, "enrollment_recovery_required")
                  : finish(json({ state: "enrollment_delivery_unavailable", nextAction: "restart_reauthentication" }, 409))
              }
              enrolled = await input.runtime.beginTotpEnrollment(
                auth as OpaqueAuthSession,
                { reauthenticationProof: security.reauthenticationProof,
                  priorTransactionRef: recovered.supersede.priorTransactionRef },
                { command: recovered.supersede.command, priorCommandId: recovered.supersede.priorCommandId },
              )
              if (!("transaction" in enrolled)) {
                return persistOneTimeUnavailable({
                  ...state,
                  command: recovered.supersede.command,
                  lastUsedAt: now(),
                  security: {
                    phase: "totp_enrollment_delivery",
                    reauthenticationProof: security.reauthenticationProof,
                    supersedePriorCommandId: recovered.supersede.priorCommandId,
                    priorTransactionRef: recovered.supersede.priorTransactionRef,
                  },
                }, "enrollment_recovery_required")
              }
            }
            const updated: LaunchCommandState = {
              ...state,
              command: input.runtime.createOneTimeCommand(),
              lastUsedAt: now(),
              expiresAt: ceremonyExpiresAt(now(), enrolled.transaction.expiresAt),
              security: { phase: "totp_confirmation", transactionRef: enrolled.transaction.transactionRef },
            }
            return persist(updated, json({
              state: "totp_confirmation_required",
              manualEntrySecret: enrolled.transaction.manualEntrySecret,
              otpauthUri: enrolled.transaction.otpauthUri,
              expiresAt: enrolled.transaction.expiresAt,
            }))
          }

          const runRecoveryCodeDelivery = async (
            security: Readonly<{ reauthenticationProof: string; supersedePriorCommandId?: string }>,
            deliveryCommand: SiteOneTimeCommand,
          ): Promise<Response> => {
            let regenerated = await input.runtime.regenerateRecoveryCodes(
              auth as OpaqueAuthSession,
              { reauthenticationProof: security.reauthenticationProof },
              security.supersedePriorCommandId === undefined
                ? { command: deliveryCommand }
                : { command: deliveryCommand, priorCommandId: security.supersedePriorCommandId },
            )
            if (!("recoveryCodes" in regenerated)) {
              const recovered = await recoveryRecipe("regenerateRecoveryCodes", deliveryCommand)
              if (recovered.supersede === null) {
                return recovered.receipt.reconciliation.kind === "pending"
                  ? persistOneTimeUnavailable({ ...state, command: deliveryCommand, lastUsedAt: now(),
                      security: { phase: "recovery_code_delivery", ...security } }, "recovery_code_delivery_recovery_required")
                  : finish(json({ state: "recovery_codes_unavailable", nextAction: "restart_reauthentication" }, 409))
              }
              regenerated = await input.runtime.regenerateRecoveryCodes(
                auth as OpaqueAuthSession,
                { reauthenticationProof: security.reauthenticationProof },
                { command: recovered.supersede.command, priorCommandId: recovered.supersede.priorCommandId },
              )
              if (!("recoveryCodes" in regenerated)) {
                return persistOneTimeUnavailable({
                  ...state,
                  command: recovered.supersede.command,
                  lastUsedAt: now(),
                  security: {
                    phase: "recovery_code_delivery",
                    reauthenticationProof: security.reauthenticationProof,
                    supersedePriorCommandId: recovered.supersede.priorCommandId,
                  },
                }, "recovery_code_delivery_recovery_required")
              }
            }
            return finish(json({ state: "succeeded", generatedAt: regenerated.generatedAt, recoveryCodes: regenerated.recoveryCodes }))
          }

          if (state.security.phase === "totp_enrollment_delivery") {
            if (requestedOperation !== "identity.enroll-totp" || command === null) return unavailable(409)
            return runEnrollmentDelivery(state.security, command)
          }

          if (state.security.phase === "recovery_code_delivery") {
            if (requestedOperation !== "identity.regenerate-recovery-codes" || command === null) return unavailable(409)
            return runRecoveryCodeDelivery(state.security, command)
          }

          if (state.security.phase === "totp_confirmation") {
            if (requestedOperation !== "identity.enroll-totp" || command === null) return unavailable(409)
            const code = text(body.code, 6, 64)
            if (code === null) return unavailable(400)
            const response = await input.runtime.confirmTotpEnrollment(
              auth as OpaqueAuthSession,
              { transactionRef: state.security.transactionRef, code },
              { command },
            )
            if (!("recoveryCodes" in response)) {
              return finish(json({
                state: "totp_enabled_recovery_codes_unavailable",
                nextAction: "reauthenticate_and_regenerate_recovery_codes",
              }, 409))
            }
            return finish(json({ state: "succeeded", generatedAt: response.generatedAt, recoveryCodes: response.recoveryCodes }))
          }

          if (state.security.phase === "disable_confirmation") {
            if (requestedOperation !== "identity.disable-totp") return unavailable(409)
            const code = text(body.code, 6, 64)
            if (code === null) return unavailable(400)
            await input.runtime.disableTotp(
              auth as OpaqueAuthSession,
              { reauthenticationProof: state.security.reauthenticationProof, code },
              state.command,
            )
            return finish(json({ state: "succeeded" }))
          }

          if (command === null) return unavailable(409)

          const reauthentication = state.security.phase === "reauthenticate_password"
            ? (() => {
                const password = text(body.password, 1, 1024)
                return password === null ? null : { stage: "password" as const, password, target }
              })()
            : (() => {
                const code = text(body.code, 6, 128)
                return code === null ? null : {
                  stage: "mfa" as const,
                  challengeKind: state.security.challengeKind,
                  proofCode: code,
                  transactionRef: state.security.transactionRef,
                  target,
                }
              })()
          if (reauthentication === null) return unavailable(400)
          let reauthenticationCommand = command
          let reauthenticated = await input.runtime.reauthenticate(
            auth as OpaqueAuthSession,
            reauthentication,
            state.security.supersedePriorCommandId === undefined
              ? { command: reauthenticationCommand }
              : { command: reauthenticationCommand, priorCommandId: state.security.supersedePriorCommandId },
          )
          if ("kind" in reauthenticated) {
            const recovered = await recoveryRecipe("reauthenticateIdentitySession", reauthenticationCommand)
            if (recovered.supersede === null) {
              return recovered.receipt.reconciliation.kind === "pending"
                ? persistOneTimeUnavailable({ ...state, lastUsedAt: now() }, "reauthentication_recovery_required")
                : finish(json({ state: "reauthentication_expired", nextAction: "restart" }, 409))
            }
            reauthenticationCommand = recovered.supersede.command
            reauthenticated = await input.runtime.reauthenticate(
              auth as OpaqueAuthSession,
              reauthentication,
              { command: reauthenticationCommand, priorCommandId: recovered.supersede.priorCommandId },
            )
            if ("kind" in reauthenticated) {
              return persistOneTimeUnavailable({
                ...state,
                command: reauthenticationCommand,
                lastUsedAt: now(),
                security: { ...state.security, supersedePriorCommandId: recovered.supersede.priorCommandId },
              }, "reauthentication_recovery_required")
            }
          }
          if ("pending" in reauthenticated) {
            const nextCommand = input.runtime.createOneTimeCommand()
            const expiresAt = ceremonyExpiresAt(now(), reauthenticated.pending.expiresAt)
            const updated: LaunchCommandState = {
              ...state,
              command: nextCommand,
              lastUsedAt: now(),
              expiresAt,
              security: {
                phase: "reauthenticate_mfa",
                challengeKind: reauthenticated.pending.challengeKind,
                transactionRef: reauthenticated.pending.transactionRef,
              },
            }
            return persist(updated, json({
              state: "mfa_required",
              challengeKind: reauthenticated.pending.challengeKind,
              expiresAt: reauthenticated.pending.expiresAt,
            }))
          }
          if (!("proof" in reauthenticated) || reauthenticated.proof.operationId !== target.operationId) return unavailable(409)
          const reauthenticationProof = reauthenticated.proof.reauthenticationProof

          if (requestedOperation === "identity.disable-totp") {
            const updated: LaunchCommandState = {
              ...state,
              command: input.runtime.createCommand(),
              lastUsedAt: now(),
              expiresAt: ceremonyExpiresAt(now(), reauthenticated.proof.expiresAt),
              security: { phase: "disable_confirmation", reauthenticationProof },
            }
            return persist(updated, json({ state: "totp_confirmation_required" }))
          }

          if (requestedOperation === "identity.regenerate-recovery-codes") {
            return runRecoveryCodeDelivery({ reauthenticationProof }, input.runtime.createOneTimeCommand())
          }

          return runEnrollmentDelivery({ reauthenticationProof }, input.runtime.createOneTimeCommand())
        }
        case "redemption.preview": {
          const code = text(body.code, 16, 256)
          if (code === null || !/^[A-Za-z0-9-]+$/u.test(code)) return unavailable(400)
          const response = await input.runtime.previewRedemption(auth as OpaqueAuthSession, code, state.command)
          const updated: LaunchCommandState = {
            ...state,
            lastUsedAt: now(),
            preview: {
              previewCredential: response.preview.previewCredential,
              legalAcceptanceRefs: response.preview.legalTermRefs,
            },
          }
          return setState(json(publicPreview(response, input.legalDocuments ?? [])), vault.seal(vault.put(entries, updated)))
        }
        case "redemption.confirm": {
          const previewFlowRef = flow(body.previewFlowRef)
          const preview = previewFlowRef === null ? undefined : vault.find(entries, "redemption.preview", previewFlowRef)?.preview
          if (preview === undefined) return json({ state: "preview_required" }, 409)
          if (preview.legalAcceptanceRefs.length > 0 && body.legalAccepted !== true) {
            return json({ state: "legal_acceptance_required" }, 400)
          }
          const response = await input.runtime.confirmRedemption(auth as OpaqueAuthSession, preview, state.command)
          return json(publicRedemption(response))
        }
      }
    } catch (error) {
      if (error === EXACT_RETRY_REQUIRED) {
        return json({ state: "exact_retry_required" }, 409)
      }
      // Intentionally does not stringify the request, Code, credentials, command identity, or upstream error.
      return unavailable()
    }
  }

  return Object.freeze({ handle })
}

export type SiteLaunchApi = ReturnType<typeof createSiteLaunchApi>

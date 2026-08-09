export type RedemptionPendingResult = Readonly<{
  state: "accepted" | "executing" | "outcome_unknown"
  retryAfter: string
}>

type RedemptionProductState = "fulfilled" | "reversed" | "reconciliation_required"

export type RedemptionTerminalResult =
  | Readonly<{ state: "succeeded"; productState: RedemptionProductState; redeemedAt: string }>
  | Readonly<{ state: "rejected"; retry: "never" | "after_delay" | "after_user_action" }>
  | Readonly<{ state: "review_required"; expiresAt: string }>

export type RedemptionCommandResult = RedemptionPendingResult | RedemptionTerminalResult

export type RedemptionPollOutcome =
  | Readonly<{ kind: "terminal"; result: RedemptionTerminalResult }>
  | Readonly<{ kind: "interrupted"; reason: "network" | "protocol" | "timeout"; pending: RedemptionPendingResult }>

const PENDING_STATES = new Set(["accepted", "executing", "outcome_unknown"])
const PRODUCT_STATES = new Set(["fulfilled", "reversed", "reconciliation_required"])
const RETRY_CLASSES = new Set(["never", "after_delay", "after_user_action"])
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u
const MAXIMUM_RECOVERY_ATTEMPTS = 6
export const REDEMPTION_RECOVERY_WINDOW_MS = 30_000

class RecoveryBoundaryError extends Error {
  constructor(readonly reason: "timeout" | "cancelled") {
    super(`redemption_recovery_${reason}`)
  }
}

export function isRedemptionPending(result: RedemptionCommandResult): result is RedemptionPendingResult {
  return result.state === "accepted" || result.state === "executing" || result.state === "outcome_unknown"
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && UTC_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
}

export function parseRedemptionCommandResult(value: unknown): RedemptionCommandResult {
  const input = record(value)
  const state = input?.state
  if (input === null || typeof state !== "string") throw new Error("redemption_response_invalid")

  if (PENDING_STATES.has(state)) {
    if (!exactKeys(input, ["state", "retryAfter"]) || !timestamp(input.retryAfter)) {
      throw new Error("redemption_response_invalid")
    }
    return { state: state as RedemptionPendingResult["state"], retryAfter: input.retryAfter }
  }
  if (state === "succeeded") {
    if (
      !exactKeys(input, ["state", "productState", "redeemedAt"]) ||
      typeof input.productState !== "string" || !PRODUCT_STATES.has(input.productState) ||
      !timestamp(input.redeemedAt)
    ) throw new Error("redemption_response_invalid")
    return {
      state,
      productState: input.productState as RedemptionProductState,
      redeemedAt: input.redeemedAt,
    }
  }
  if (state === "rejected") {
    if (
      !exactKeys(input, ["state", "retry"]) ||
      typeof input.retry !== "string" || !RETRY_CLASSES.has(input.retry)
    ) throw new Error("redemption_response_invalid")
    return { state, retry: input.retry as "never" | "after_delay" | "after_user_action" }
  }
  if (state === "review_required") {
    if (!exactKeys(input, ["state", "expiresAt"]) || !timestamp(input.expiresAt)) {
      throw new Error("redemption_response_invalid")
    }
    return { state, expiresAt: input.expiresAt }
  }
  throw new Error("redemption_response_invalid")
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, delayMs)
    function finish() {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      reject(new RecoveryBoundaryError("cancelled"))
    }
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}

async function runBeforeDeadline<T>(input: Readonly<{
  deadline: number
  now(): number
  signal?: AbortSignal
  task(signal: AbortSignal): Promise<T>
}>): Promise<T> {
  const remainingMs = input.deadline - input.now()
  if (remainingMs <= 0) throw new RecoveryBoundaryError("timeout")
  if (input.signal?.aborted) throw new RecoveryBoundaryError("cancelled")

  const controller = new AbortController()
  let boundary: "timeout" | "cancelled" | null = null
  const abort = (reason: "timeout" | "cancelled") => {
    if (boundary !== null) return
    boundary = reason
    controller.abort(reason)
  }
  const cancel = () => abort("cancelled")
  input.signal?.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => abort("timeout"), remainingMs)
  const interrupted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(new RecoveryBoundaryError(boundary ?? "cancelled"))
    }, { once: true })
  })

  try {
    return await Promise.race([input.task(controller.signal), interrupted])
  } catch (error) {
    if (boundary !== null) throw new RecoveryBoundaryError(boundary)
    throw error
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener("abort", cancel)
  }
}

export async function pollRedemptionCommand(input: Readonly<{
  initial: RedemptionPendingResult
  recover(signal: AbortSignal): Promise<unknown>
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
  maximumAttempts?: number
  maximumElapsedMs?: number
  deadline?: number
  signal?: AbortSignal
}>): Promise<RedemptionPollOutcome> {
  const now = input.now ?? Date.now
  const maximumAttempts = input.maximumAttempts ?? MAXIMUM_RECOVERY_ATTEMPTS
  const deadline = input.deadline ?? now() + (input.maximumElapsedMs ?? REDEMPTION_RECOVERY_WINDOW_MS)
  let pending = input.initial

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const retryAt = Date.parse(pending.retryAfter)
    const delayMs = Math.max(0, retryAt - now())
    if (!Number.isFinite(retryAt)) return { kind: "interrupted", reason: "protocol", pending }
    if (delayMs > deadline - now()) return { kind: "interrupted", reason: "timeout", pending }
    try {
      await runBeforeDeadline({
        deadline,
        now,
        signal: input.signal,
        task: (signal) => input.sleep === undefined
          ? defaultSleep(delayMs, signal)
          : input.sleep(delayMs),
      })
    } catch (error) {
      if (error instanceof RecoveryBoundaryError && (error.reason === "timeout" || now() >= deadline)) {
        return { kind: "interrupted", reason: "timeout", pending }
      }
      return { kind: "interrupted", reason: "network", pending }
    }
    if (now() >= deadline) return { kind: "interrupted", reason: "timeout", pending }

    let recoveredValue: unknown
    try {
      recoveredValue = await runBeforeDeadline({
        deadline,
        now,
        signal: input.signal,
        task: input.recover,
      })
    } catch (error) {
      if (error instanceof RecoveryBoundaryError && (error.reason === "timeout" || now() >= deadline)) {
        return { kind: "interrupted", reason: "timeout", pending }
      }
      return { kind: "interrupted", reason: "network", pending }
    }
    let recovered: RedemptionCommandResult
    try {
      recovered = parseRedemptionCommandResult(recoveredValue)
    } catch {
      return {
        kind: "interrupted",
        reason: "protocol",
        pending,
      }
    }
    if (isRedemptionPending(recovered)) {
      pending = recovered
      continue
    }
    return { kind: "terminal", result: recovered }
  }
  return { kind: "interrupted", reason: "timeout", pending }
}

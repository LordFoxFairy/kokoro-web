// User Web BFF 出站调用的统一 deadline。配置错误必须在服务装配时显式失败，不能静默变成
// preview；运行时 deadline 使用可清理 timer，避免把不可取消的 AbortSignal.timeout 留给长流。

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000
export const MIN_UPSTREAM_TIMEOUT_MS = 100
export const MAX_UPSTREAM_TIMEOUT_MS = 60_000

export class UpstreamTimeoutConfigurationError extends Error {
  constructor(name: string, raw: string) {
    super(`${name} must be an integer between ${MIN_UPSTREAM_TIMEOUT_MS} and ${MAX_UPSTREAM_TIMEOUT_MS}; got ${JSON.stringify(raw)}`)
    this.name = "UpstreamTimeoutConfigurationError"
  }
}

export function parseUpstreamTimeoutMs(
  raw: string | undefined,
  name = "KOKORO_WEB_UPSTREAM_TIMEOUT_MS",
): number {
  if (raw === undefined) return DEFAULT_UPSTREAM_TIMEOUT_MS
  const normalized = raw.trim()
  if (!/^\d+$/.test(normalized)) throw new UpstreamTimeoutConfigurationError(name, raw)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < MIN_UPSTREAM_TIMEOUT_MS || parsed > MAX_UPSTREAM_TIMEOUT_MS) {
    throw new UpstreamTimeoutConfigurationError(name, raw)
  }
  return parsed
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super("upstream deadline exceeded")
    this.name = "UpstreamTimeoutError"
  }
}

export function isUpstreamTimeoutError(error: unknown): error is UpstreamTimeoutError {
  return error instanceof UpstreamTimeoutError
}

export interface UpstreamDeadline {
  signal: AbortSignal
  start(): void
  finish(): void
  didTimeout(): boolean
}

export function createUpstreamDeadline(
  requestSignal: AbortSignal | undefined,
  timeoutMs: number,
  options: { startImmediately?: boolean } = {},
): UpstreamDeadline {
  const timeoutController = new AbortController()
  const signal = requestSignal === undefined
    ? timeoutController.signal
    : AbortSignal.any([requestSignal, timeoutController.signal])
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  let finished = false

  const start = (): void => {
    if (finished || timer !== null || requestSignal?.aborted) return
    timer = setTimeout(() => {
      timer = null
      if (requestSignal?.aborted || finished) return
      timedOut = true
      timeoutController.abort(new UpstreamTimeoutError())
    }, timeoutMs)
  }
  const finish = (): void => {
    finished = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  if (options.startImmediately !== false) start()
  return { signal, start, finish, didTimeout: () => timedOut }
}

export async function withUpstreamDeadline<T>(
  requestSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = createUpstreamDeadline(requestSignal, timeoutMs)
  try {
    const result = await operation(deadline.signal)
    // 有界 body reader 可能把 abort 归一成 null；deadline 仍是权威原因，不能误报 bad response/502。
    if (deadline.didTimeout()) throw new UpstreamTimeoutError()
    return result
  } catch (error) {
    if (deadline.didTimeout()) throw new UpstreamTimeoutError()
    throw error
  } finally {
    deadline.finish()
  }
}

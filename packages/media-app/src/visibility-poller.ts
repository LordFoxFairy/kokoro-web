export interface PollingEnvironment {
  visible(): boolean
  schedule(task: () => void, delayMs: number): number
  cancel(timer: number): void
  observeVisibility(listener: () => void): () => void
}

export interface VisibilityAwarePoller {
  setKeys(keys: readonly string[]): void
  stop(): void
}

function browserEnvironment(): PollingEnvironment {
  return Object.freeze({
    visible: () => document.visibilityState === "visible",
    schedule: (task: () => void, delayMs: number) => window.setTimeout(task, delayMs),
    cancel: (timer: number) => window.clearTimeout(timer),
    observeVisibility(listener: () => void) {
      document.addEventListener("visibilitychange", listener)
      return () => document.removeEventListener("visibilitychange", listener)
    },
  })
}

/** Abortable, visibility-aware polling with bounded concurrency and exponential failure backoff. */
export function createVisibilityAwarePoller<Value>(input: Readonly<{
  fetchValue(key: string, signal: AbortSignal): Promise<Value>
  onValues(values: readonly Value[], signal: AbortSignal): boolean | void | Promise<boolean | void>
  onFailure(error: unknown): void
  onRecovery?(): void
  environment?: PollingEnvironment
  initialDelayMs?: number
  maximumDelayMs?: number
  concurrency?: number
}>): VisibilityAwarePoller {
  const environment = input.environment ?? browserEnvironment()
  const initialDelayMs = input.initialDelayMs ?? 2_000
  const maximumDelayMs = input.maximumDelayMs ?? 16_000
  const concurrency = input.concurrency ?? 4
  if (
    !Number.isInteger(initialDelayMs) || initialDelayMs < 1 ||
    !Number.isInteger(maximumDelayMs) || maximumDelayMs < initialDelayMs ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8
  ) throw new TypeError("invalid polling bounds")

  let keys: readonly string[] = []
  let delayMs = initialDelayMs
  let timer: number | undefined
  let controller: AbortController | undefined
  let generation = 0
  let stopped = false
  let recoveringFromFailure = false

  const clear = () => {
    if (timer !== undefined) environment.cancel(timer)
    timer = undefined
  }
  const pause = () => {
    generation += 1
    clear()
    controller?.abort("polling paused")
    controller = undefined
  }
  const schedule = (waitMs: number) => {
    clear()
    if (stopped || keys.length === 0 || !environment.visible()) return
    const scheduledGeneration = generation
    timer = environment.schedule(() => {
      timer = undefined
      void run(scheduledGeneration)
    }, waitMs)
  }
  const run = async (scheduledGeneration: number) => {
    if (stopped || scheduledGeneration !== generation || keys.length === 0 || !environment.visible()) return
    const active = new AbortController()
    controller = active
    try {
      const values: Value[] = []
      const failures: unknown[] = []
      for (let offset = 0; offset < keys.length; offset += concurrency) {
        if (active.signal.aborted || scheduledGeneration !== generation) return
        const settled = await Promise.allSettled(
          keys.slice(offset, offset + concurrency).map((key) => input.fetchValue(key, active.signal)),
        )
        for (const result of settled) {
          if (result.status === "fulfilled") values.push(result.value)
          else failures.push(result.reason)
        }
      }
      if (active.signal.aborted || scheduledGeneration !== generation) return
      const madeProgress = values.length === 0 ? false : await input.onValues(Object.freeze(values), active.signal)
      if (failures.length > 0) {
        recoveringFromFailure = true
        for (const failure of failures) input.onFailure(failure)
      } else if (recoveringFromFailure) {
        recoveringFromFailure = false
        input.onRecovery?.()
      }
      delayMs = failures.length > 0 || madeProgress === false
        ? Math.min(maximumDelayMs, delayMs * 2)
        : initialDelayMs
    } catch (error) {
      if (!active.signal.aborted && scheduledGeneration === generation) {
        recoveringFromFailure = true
        input.onFailure(error)
        delayMs = Math.min(maximumDelayMs, delayMs * 2)
        active.abort("polling batch failed")
      }
    } finally {
      if (controller === active) controller = undefined
      if (scheduledGeneration === generation) schedule(delayMs)
    }
  }
  const unobserve = environment.observeVisibility(() => {
    if (!environment.visible()) pause()
    else schedule(0)
  })

  return Object.freeze({
    setKeys(nextKeys: readonly string[]) {
      const normalized = Object.freeze([...new Set(nextKeys)])
      if (normalized.length > 100) throw new TypeError("too many polling keys")
      if (normalized.length === keys.length && normalized.every((key, index) => key === keys[index])) return
      pause()
      keys = normalized
      delayMs = initialDelayMs
      schedule(initialDelayMs)
    },
    stop() {
      if (stopped) return
      stopped = true
      pause()
      unobserve()
    },
  })
}

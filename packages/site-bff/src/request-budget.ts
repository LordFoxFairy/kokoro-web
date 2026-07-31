export interface SiteRequestBudget {
  readonly signal: AbortSignal
  remainingDeadlineMs(): number
}

/** Bounds caller waiting while the same signal/deadline is propagated into each upstream transport. */
export function waitWithinBudget<Value>(promise: Promise<Value>, budget: SiteRequestBudget): Promise<Value> {
  const timeoutMs = budget.remainingDeadlineMs()
  return new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      budget.signal.removeEventListener("abort", abort)
      run()
    }
    const abort = () => finish(() => reject(budget.signal.reason ?? new Error("Site request aborted")))
    const timer = setTimeout(() => finish(() => reject(new Error("Site request deadline exhausted"))), timeoutMs)
    timer.unref()
    budget.signal.addEventListener("abort", abort, { once: true })
    if (budget.signal.aborted) abort()
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

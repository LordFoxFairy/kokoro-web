export interface ScopedRequestHandle {
  readonly signal: AbortSignal
  isCurrent(): boolean
  finish(): void
  abort(reason?: string): void
}

export interface ScopedRequestCoordinator {
  begin(slot: string, expectedScope: string): ScopedRequestHandle
  isScopeCurrent(expectedScope: string): boolean
  reset(nextScope: string): void
  invalidate(expectedScope: string): void
  stop(): void
}

type ActiveRequest = Readonly<{
  controller: AbortController
  generation: number
}>

function validLabel(value: string, name: string): string {
  if (value.trim() === "" || value.length > 512) throw new TypeError(`invalid ${name}`)
  return value
}

/**
 * Owns request cancellation and a generation fence for one browser product.
 * The generation check remains authoritative when an upstream ignores abort.
 */
export function createScopedRequestCoordinator(initialScope: string): ScopedRequestCoordinator {
  let scope = validLabel(initialScope, "browser runtime scope")
  let generation = 0
  let active = true
  let stopped = false
  const slots = new Map<string, ActiveRequest>()

  const abortAll = (reason: string) => {
    for (const request of slots.values()) request.controller.abort(reason)
    slots.clear()
  }
  const currentScope = (expectedScope: string) => (
    !stopped && active && scope === expectedScope
  )

  return Object.freeze({
    begin(slotInput: string, expectedScope: string): ScopedRequestHandle {
      const slot = validLabel(slotInput, "request slot")
      if (!currentScope(expectedScope)) throw new TypeError("browser runtime scope is no longer current")
      slots.get(slot)?.controller.abort("superseded by a newer request")
      const request: ActiveRequest = Object.freeze({
        controller: new AbortController(),
        generation,
      })
      slots.set(slot, request)
      const isCurrent = () => (
        currentScope(expectedScope) &&
        request.generation === generation &&
        slots.get(slot) === request &&
        !request.controller.signal.aborted
      )
      return Object.freeze({
        signal: request.controller.signal,
        isCurrent,
        finish() {
          if (slots.get(slot) === request) slots.delete(slot)
        },
        abort(reason = "request canceled") {
          request.controller.abort(reason)
          if (slots.get(slot) === request) slots.delete(slot)
        },
      })
    },
    isScopeCurrent: currentScope,
    reset(nextScope: string) {
      abortAll("browser runtime scope changed")
      generation += 1
      scope = validLabel(nextScope, "browser runtime scope")
      active = true
      stopped = false
    },
    invalidate(expectedScope: string) {
      if (!currentScope(expectedScope)) return
      abortAll("browser runtime scope invalidated")
      generation += 1
      active = false
    },
    stop() {
      if (stopped) return
      abortAll("browser product unmounted")
      generation += 1
      active = false
      stopped = true
    },
  })
}

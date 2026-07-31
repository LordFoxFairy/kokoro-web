import type { MediaOperationCommandReceipt } from "@kokoro/site-client"
import { describe, expect, test, vi } from "vitest"

import { applyMediaCommandReceipt, mediaCommandReconciliation } from "../src/command-recovery"
import { mergeMediaOperationOwnerStates } from "../src/owner-refresh"
import { createVisibilityAwarePoller, type PollingEnvironment } from "../src/visibility-poller"

function receipt(input: Partial<MediaOperationCommandReceipt> & Pick<MediaOperationCommandReceipt, "receiptKind">) {
  return input as MediaOperationCommandReceipt
}

describe("media command recovery", () => {
  test.each([
    ["submit accepted", receipt({ commandId: "command-1", receiptKind: "submit_accepted" }), { kind: "terminal" }, true],
    ["cancel rejected", receipt({ commandId: "command-2", receiptKind: "cancel_rejected" }), { kind: "terminal" }, true],
    ["unknown", receipt({ commandId: "command-3", receiptKind: "submit_outcome_unknown", recoveryAction: "recover_command" }), { kind: "recover_command" }, false],
  ] as const)("classifies %s without dropping an unknown command", (_name, commandReceipt, expected, shouldForget) => {
    const forget = vi.fn()
    expect(applyMediaCommandReceipt({ forget }, commandReceipt)).toEqual(expected)
    expect(forget).toHaveBeenCalledTimes(shouldForget ? 1 : 0)
  })

  test("follows get-operation and contact-support recovery actions without inventing owner state", () => {
    expect(mediaCommandReconciliation(receipt({
      receiptKind: "cancel_outcome_unknown",
      recoveryAction: "get_operation",
      operationRef: "operation-1",
    }))).toEqual({ kind: "get_operation", operationRef: "operation-1" })
    expect(mediaCommandReconciliation(receipt({
      receiptKind: "submit_outcome_unknown",
      recoveryAction: "contact_support",
      safeFailure: { code: "outcome_unknown", retryClass: "reconcile_receipt", safeMessage: "Contact support." },
    }))).toEqual({ kind: "contact_support", safeMessage: "Contact support." })
  })
})

describe("media owner refresh", () => {
  const current = {
    mediaOperationRef: "operation-1",
    definitionRef: "image.text_to_image",
    definitionRevisionRef: "image.text_to_image@1",
    modelOptionRevisionRef: "image.safe@1",
    ownerVersion: "2",
    progressBps: 2000,
    candidates: [],
    updatedAt: "2026-07-31T00:00:02.000Z",
    state: "active" as const,
  }

  test("accepts only monotonic valid owner updates and never reopens a terminal owner", () => {
    expect(mergeMediaOperationOwnerStates([current], [{
      ...current,
      ownerVersion: "1",
      progressBps: 1000,
      updatedAt: "2026-07-31T00:00:01.000Z",
    }])).toEqual([current])
    const completed = {
      ...current,
      ownerVersion: "3",
      progressBps: 10_000,
      updatedAt: "2026-07-31T00:00:03.000Z",
      state: "completed" as const,
      outcomeClass: "canonical" as const,
    }
    expect(mergeMediaOperationOwnerStates([current], [completed])).toEqual([completed])
    expect(mergeMediaOperationOwnerStates([completed], [{
      ...current,
      ownerVersion: "4",
      progressBps: 8000,
      updatedAt: "2026-07-31T00:00:04.000Z",
    }])).toEqual([completed])
  })

  test("never changes the immutable model option identity at a higher owner version", () => {
    expect(mergeMediaOperationOwnerStates([current], [{
      ...current,
      modelOptionRevisionRef: "image.other@2",
      ownerVersion: "3",
      updatedAt: "2026-07-31T00:00:03.000Z",
    }])).toEqual([current])
  })
})

describe("visibility-aware bounded poller", () => {
  test("settles each key so a failed command cannot starve successful reconciliation", async () => {
    let nextTimer = 0
    const scheduled = new Map<number, { task: () => void; delayMs: number }>()
    const environment: PollingEnvironment = {
      visible: () => true,
      schedule(task, delayMs) {
        const id = ++nextTimer
        scheduled.set(id, { task, delayMs })
        return id
      },
      cancel: (id) => { scheduled.delete(id) },
      observeVisibility: () => () => undefined,
    }
    const onValues = vi.fn()
    const onFailure = vi.fn()
    const poller = createVisibilityAwarePoller({
      environment,
      fetchValue: (key) => key === "bad" ? Promise.reject(new Error("bad command")) : Promise.resolve(key),
      onValues,
      onFailure,
      initialDelayMs: 100,
      maximumDelayMs: 400,
      concurrency: 2,
    })

    poller.setKeys(["good", "bad"])
    const first = [...scheduled.entries()][0]
    if (first === undefined) throw new Error("missing poll")
    scheduled.delete(first[0])
    first[1].task()

    await vi.waitFor(() => expect(onValues).toHaveBeenCalledWith(["good"], expect.any(AbortSignal)))
    expect(onFailure).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect([...scheduled.values()].map(({ delayMs }) => delayMs)).toEqual([200]))
    poller.stop()
  })

  test("polls only supplied keys, backs off on failure, and aborts an in-flight read when hidden", async () => {
    let visible = true
    let visibilityListener: () => void = () => undefined
    let nextTimer = 0
    const scheduled = new Map<number, { task: () => void; delayMs: number }>()
    const environment: PollingEnvironment = {
      visible: () => visible,
      schedule(task, delayMs) {
        const id = ++nextTimer
        scheduled.set(id, { task, delayMs })
        return id
      },
      cancel: (id) => { scheduled.delete(id) },
      observeVisibility(listener) {
        visibilityListener = listener
        return () => { visibilityListener = () => undefined }
      },
    }
    const signals: AbortSignal[] = []
    const fetchValue = vi.fn((key: string, signal: AbortSignal): Promise<string> => {
      signals.push(signal)
      if (fetchValue.mock.calls.length === 1) return Promise.reject(new Error("temporary"))
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    })
    const poller = createVisibilityAwarePoller({
      environment,
      fetchValue,
      onValues: vi.fn(),
      onFailure: vi.fn(),
      initialDelayMs: 100,
      maximumDelayMs: 400,
      concurrency: 2,
    })

    poller.setKeys(["operation-active", "operation-active"])
    expect([...scheduled.values()].map(({ delayMs }) => delayMs)).toEqual([100])
    const first = [...scheduled.entries()][0]
    if (first === undefined) throw new Error("missing first poll")
    scheduled.delete(first[0])
    first[1].task()
    await vi.waitFor(() => expect(fetchValue).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect([...scheduled.values()].map(({ delayMs }) => delayMs)).toEqual([200]))

    const second = [...scheduled.entries()][0]
    if (second === undefined) throw new Error("missing second poll")
    scheduled.delete(second[0])
    second[1].task()
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    visible = false
    visibilityListener()
    expect(signals[1]?.aborted).toBe(true)
    await vi.waitFor(() => expect(scheduled.size).toBe(0))

    visible = true
    visibilityListener()
    expect([...scheduled.values()].map(({ delayMs }) => delayMs)).toEqual([0])
    poller.stop()
    expect(scheduled.size).toBe(0)
  })
})

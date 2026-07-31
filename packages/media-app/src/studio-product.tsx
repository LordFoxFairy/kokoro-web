"use client"

import type { MediaOperationOwnerState } from "@kokoro/chat-surface"
import type {
  ImageAspectRatio,
  ImageOutputFormat,
  MediaOperationCommandResponse,
  MediaOperationInput,
  OperationDefinition,
  PublishedModelOption,
} from "@kokoro/site-client"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  createMediaBrowserClient,
  createMediaCommandIdentity,
  createMediaCommandRecoveryStore,
  type MediaBrowserFetch,
} from "./browser-client"
import { applyMediaCommandReceipt } from "./command-recovery"
import { MEDIA_OPERATION_TERMINAL_STATES, mergeMediaOperationOwnerStates } from "./owner-refresh"
import { projectPlatformMediaOperationOwnerState } from "./owner-projection"
import {
  createScopedRequestCoordinator,
  type ScopedRequestHandle,
} from "./scoped-requests"
import { createVisibilityAwarePoller, type VisibilityAwarePoller } from "./visibility-poller"
import styles from "./media-product.module.css"

export type StudioQuoteView = Readonly<{
  amount: string
  creditUnit: string
  expiresAt: string
  inputRevision: number
}>

export function isStudioQuoteActive(
  quote: StudioQuoteView | null,
  inputRevision: number,
  now = Date.now(),
): quote is StudioQuoteView {
  return quote !== null && quote.inputRevision === inputRevision && Date.parse(quote.expiresAt) > now
}

function wasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

function stateLabel(state: MediaOperationOwnerState["state"]): string {
  switch (state) {
    case "admission_pending": return "Checking admission"
    case "authorized": return "Authorized"
    case "queued": return "Queued"
    case "active": return "Creating"
    case "finalizing": return "Finalizing"
    case "cancel_requested": return "Cancel requested"
    case "reconciling": return "Reconciling"
    case "completed": return "Completed"
    case "partial": return "Partially completed"
    case "failed": return "Failed"
    case "canceled": return "Canceled"
  }
}

export function createStudioOperationInput(input: Readonly<{
  definition: OperationDefinition | undefined
  options: readonly PublishedModelOption[]
  optionRef: string
  prompt: string
  aspectRatio: ImageAspectRatio
  outputFormat: ImageOutputFormat
  candidateCount: number
}>): MediaOperationInput | null {
  const { definition } = input
  const prompt = input.prompt.trim()
  if (
    definition?.kind !== "image_text_to_image" ||
    prompt === "" ||
    new TextEncoder().encode(prompt).byteLength > definition.promptMaximumUtf8Bytes ||
    !input.options.some(({ availability, modelOptionRevisionRef }) => (
      availability === "available" && modelOptionRevisionRef === input.optionRef
    )) ||
    !definition.supportedAspectRatios.includes(input.aspectRatio) ||
    !definition.supportedOutputFormats.includes(input.outputFormat) ||
    !Number.isInteger(input.candidateCount) ||
    input.candidateCount < 1 ||
    input.candidateCount > definition.maximumCandidateCount
  ) return null
  return Object.freeze({
    kind: definition.kind,
    definitionRevisionRef: definition.definitionRevisionRef,
    promptIntent: prompt,
    aspectRatio: input.aspectRatio,
    candidateCount: input.candidateCount,
    modelOptionRevisionRef: input.optionRef,
    outputFormat: input.outputFormat,
  })
}

export function StudioView(props: Readonly<{
  brandName: string
  definitions: readonly OperationDefinition[]
  options: readonly PublishedModelOption[]
  operations: readonly MediaOperationOwnerState[]
  quote: StudioQuoteView | null
  busy: boolean
  error: string | null
  onQuote(input: MediaOperationInput, inputRevision: number): void
  onSubmit(input: MediaOperationInput, inputRevision: number): void
  onCancel(operation: MediaOperationOwnerState): void
  onRefresh(): void
  onInputChanged?(): void
}>) {
  const definition = props.definitions[0]
  const [prompt, setPrompt] = useState("")
  const [optionRef, setOptionRef] = useState(props.options.find(({ availability }) => availability === "available")?.modelOptionRevisionRef ?? "")
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("square_1_1")
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>("png")
  const [candidateCount, setCandidateCount] = useState(1)
  const [inputRevision, setInputRevision] = useState(0)
  const operationInput = (): MediaOperationInput | null => createStudioOperationInput({
    definition,
    options: props.options,
    optionRef,
    prompt,
    aspectRatio,
    outputFormat,
    candidateCount,
  })
  const changed = () => {
    setInputRevision((current) => current + 1)
    props.onInputChanged?.()
  }
  const activeQuote = isStudioQuoteActive(props.quote, inputRevision) ? props.quote : null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = operationInput()
    if (input !== null) props.onQuote(input, inputRevision)
  }
  return <main className={styles.productShell}>
    <header className={styles.productHeader}>
      <div><span className={styles.eyebrow}>Independent Site workspace</span><h1>{props.brandName} Studio</h1></div>
      <nav aria-label="Media products"><a href="/">Chat</a><a href="/library">Library</a></nav>
    </header>
    {props.error === null ? null : <p className={styles.error} role="alert">{props.error}</p>}
    <div className={styles.studioGrid}>
      <form className={styles.controlPanel} onSubmit={submit}>
        <div><span className={styles.eyebrow}>Creation brief</span><h2>{definition?.title ?? "Studio unavailable"}</h2><p>{definition?.description ?? "No published image definition is available for this Site."}</p></div>
        <label>Prompt<textarea required maxLength={definition?.kind === "image_text_to_image" ? definition.promptMaximumUtf8Bytes : 32768} value={prompt} onChange={(event) => { setPrompt(event.target.value); changed() }} /></label>
        <div className={styles.fieldGrid}>
          <label>Model<select value={optionRef} onChange={(event) => { setOptionRef(event.target.value); changed() }}>
            <option value="">Choose a published model</option>
            {props.options.map((option) => <option disabled={option.availability !== "available"} key={option.modelOptionRevisionRef} value={option.modelOptionRevisionRef}>{option.label}</option>)}
          </select></label>
          <label>Aspect<select value={aspectRatio} onChange={(event) => { setAspectRatio(event.target.value as ImageAspectRatio); changed() }}>
            {(definition?.kind === "image_text_to_image" ? definition.supportedAspectRatios : ["square_1_1"] as const).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select></label>
          <label>Format<select value={outputFormat} onChange={(event) => { setOutputFormat(event.target.value as ImageOutputFormat); changed() }}>
            {(definition?.kind === "image_text_to_image" ? definition.supportedOutputFormats : ["png"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
          </select></label>
          <label>Candidates<input min={1} max={definition?.kind === "image_text_to_image" ? definition.maximumCandidateCount : 1} step={1} type="number" value={candidateCount} onChange={(event) => { setCandidateCount(Number(event.target.value)); changed() }} /></label>
        </div>
        <div className={styles.quoteBand}>
          {activeQuote === null ? <span>Quote required before submission</span> : <span><strong>{activeQuote.amount} {activeQuote.creditUnit}</strong><small>Non-binding · expires {new Date(activeQuote.expiresAt).toLocaleTimeString()}</small></span>}
          <div><button disabled={props.busy || operationInput() === null} type="submit">Get quote</button><button disabled={props.busy || activeQuote === null || operationInput() === null} type="button" onClick={() => { const input = operationInput(); if (input !== null && isStudioQuoteActive(activeQuote, inputRevision)) props.onSubmit(input, inputRevision) }}>Create</button></div>
        </div>
      </form>
      <section className={styles.activityPanel} aria-labelledby="studio-activity">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Owner projection</span><h2 id="studio-activity">Recent operations</h2></div><button disabled={props.busy} type="button" onClick={props.onRefresh}>Refresh</button></div>
        {props.operations.length === 0 ? <p className={styles.empty}>No media operations yet.</p> : <ul className={styles.operationList}>{props.operations.map((operation) => <li key={operation.mediaOperationRef} data-state={operation.state}>
          <div><strong>{stateLabel(operation.state)}</strong><code>{operation.definitionRevisionRef}</code></div>
          <div className={styles.progress} aria-label={`${operation.progressBps / 100}% complete`}><span style={{ width: `${operation.progressBps / 100}%` }} /></div>
          <p>{operation.progressBps / 100}% · owner v{operation.ownerVersion} · {operation.candidates.length} candidate{operation.candidates.length === 1 ? "" : "s"}</p>
          {["admission_pending", "authorized", "queued", "active", "finalizing"].includes(operation.state) ? <button type="button" disabled={props.busy} onClick={() => props.onCancel(operation)}>Cancel</button> : null}
        </li>)}</ul>}
      </section>
    </div>
  </main>
}

export function StudioProduct(props: Readonly<{
  brandName: string
  csrfToken: string
  browserRuntimeScope: string
  fetch?: MediaBrowserFetch
}>) {
  const scope = props.browserRuntimeScope
  const client = useMemo(() => createMediaBrowserClient({ fetch: props.fetch, csrfToken: props.csrfToken }), [props.fetch, props.csrfToken])
  const requests = useRef<ReturnType<typeof createScopedRequestCoordinator> | null>(null)
  if (requests.current === null) requests.current = createScopedRequestCoordinator(scope)
  const [stateScope, setStateScope] = useState(scope)
  const [definitions, setDefinitions] = useState<readonly OperationDefinition[]>([])
  const [options, setOptions] = useState<readonly PublishedModelOption[]>([])
  const [operations, setOperations] = useState<readonly MediaOperationOwnerState[]>([])
  const [quote, setQuote] = useState<StudioQuoteView | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recoveryRevision, setRecoveryRevision] = useState(0)
  const quoteRequest = useRef(0)
  const operationSnapshot = useRef<readonly MediaOperationOwnerState[]>([])
  const operationPoller = useRef<VisibilityAwarePoller | null>(null)
  const commandPoller = useRef<VisibilityAwarePoller | null>(null)
  const contactSupportCommands = useRef(new Set<string>())
  const mergeOperations = useCallback((updates: readonly MediaOperationOwnerState[]) => {
    if (!requests.current?.isScopeCurrent(scope)) return false
    const merged = mergeMediaOperationOwnerStates(operationSnapshot.current, updates)
    if (merged === operationSnapshot.current) return false
    operationSnapshot.current = merged
    setOperations(merged)
    return true
  }, [scope])
  const recoveryStore = useCallback(() => createMediaCommandRecoveryStore({
    storage: window.localStorage,
    scope,
  }), [scope])
  const reconcileCommand = useCallback(async (
    response: MediaOperationCommandResponse,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (wasAborted(signal) || !requests.current?.isScopeCurrent(scope)) return false
    const recovery = recoveryStore()
    const reconciliation = applyMediaCommandReceipt(recovery, response.receipt)
    if (response.operation !== null) mergeOperations([projectPlatformMediaOperationOwnerState(response.operation)])
    if (reconciliation.kind === "get_operation") {
      const owner = await client.getOperation(reconciliation.operationRef, signal)
      if (wasAborted(signal) || !requests.current?.isScopeCurrent(scope)) return false
      mergeOperations([projectPlatformMediaOperationOwnerState(owner.operation)])
    } else if (reconciliation.kind === "contact_support") {
      contactSupportCommands.current.add(response.receipt.commandId)
      setError(reconciliation.safeMessage)
    } else if (reconciliation.kind === "terminal") {
      contactSupportCommands.current.delete(response.receipt.commandId)
    }
    setRecoveryRevision((current) => current + 1)
    return reconciliation.kind === "terminal"
  }, [client, mergeOperations, recoveryStore, scope])
  const refresh = async (signal: AbortSignal) => {
    const page = await client.listOperations({ limit: 50 }, signal)
    mergeOperations(page.items.map(projectPlatformMediaOperationOwnerState))
  }
  useEffect(() => {
    const coordinator = requests.current
    if (coordinator === null) return
    coordinator.reset(scope)
    operationSnapshot.current = Object.freeze([])
    contactSupportCommands.current.clear()
    quoteRequest.current += 1
    setStateScope(scope)
    setDefinitions(Object.freeze([]))
    setOptions(Object.freeze([]))
    setOperations(Object.freeze([]))
    setQuote(null)
    setBusy(true)
    setError(null)
    setRecoveryRevision(0)
    return () => coordinator.invalidate(scope)
  }, [scope])
  useEffect(() => {
    const coordinator = requests.current
    return () => coordinator?.stop()
  }, [])
  useEffect(() => {
    const coordinator = requests.current
    if (coordinator === null || !coordinator.isScopeCurrent(scope)) return
    const request = coordinator.begin("bootstrap", scope)
    void (async () => {
      try {
        const [definitionPage, operationPage] = await Promise.all([
          client.listDefinitions({ limit: 50 }, request.signal),
          client.listOperations({ limit: 50 }, request.signal),
        ])
        if (!request.isCurrent()) return
        setDefinitions(definitionPage.items)
        mergeOperations(operationPage.items.map(projectPlatformMediaOperationOwnerState))
        const first = definitionPage.items[0]
        if (first !== undefined) {
          const optionPage = await client.listModelOptions(first.definitionRef, { limit: 100 }, request.signal)
          if (request.isCurrent()) setOptions(optionPage.items)
        }
      } catch (failure) {
        if (request.isCurrent()) setError(failure instanceof Error ? failure.message : "Studio is unavailable")
      } finally {
        const current = request.isCurrent()
        request.finish()
        if (current) setBusy(false)
      }
    })()
    return () => request.abort("Studio bootstrap changed")
  }, [client, mergeOperations, scope])
  useEffect(() => {
    const poller = createVisibilityAwarePoller({
      fetchValue: async (operationRef, signal) => (await client.getOperation(operationRef, signal)).operation,
      onValues(values) {
        return mergeOperations(values.map(projectPlatformMediaOperationOwnerState))
      },
      onFailure: () => {
        if (requests.current?.isScopeCurrent(scope)) setError("Live media updates are temporarily delayed.")
      },
    })
    operationPoller.current = poller
    return () => {
      poller.stop()
      if (operationPoller.current === poller) operationPoller.current = null
    }
  }, [client, mergeOperations, scope])
  useEffect(() => {
    operationPoller.current?.setKeys(operations
      .filter(({ state }) => !MEDIA_OPERATION_TERMINAL_STATES.has(state))
      .map(({ mediaOperationRef }) => mediaOperationRef))
  }, [operations])
  useEffect(() => {
    const poller = createVisibilityAwarePoller({
      fetchValue: (commandId, signal) => client.recoverCommand(commandId, signal),
      async onValues(values, signal) {
        const terminal = await Promise.all(values.map((response) => reconcileCommand(response, signal)))
        return terminal.every(Boolean)
      },
      onFailure: () => {
        if (requests.current?.isScopeCurrent(scope)) setError("Command outcome reconciliation is temporarily delayed.")
      },
      initialDelayMs: 1_500,
      maximumDelayMs: 24_000,
    })
    commandPoller.current = poller
    return () => {
      poller.stop()
      if (commandPoller.current === poller) commandPoller.current = null
    }
  }, [client, reconcileCommand, scope])
  useEffect(() => {
    if (!requests.current?.isScopeCurrent(scope)) return
    commandPoller.current?.setKeys(recoveryStore().list()
      .map(({ command }) => command.commandId)
      .filter((commandId) => !contactSupportCommands.current.has(commandId)))
  }, [recoveryRevision, recoveryStore, scope])
  useEffect(() => {
    if (quote === null) return
    const remaining = Date.parse(quote.expiresAt) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setQuote(null)
      return
    }
    const timer = window.setTimeout(() => setQuote(null), Math.min(remaining, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [quote])
  const action = async (slot: string, run: (request: ScopedRequestHandle) => Promise<void>) => {
    const coordinator = requests.current
    if (coordinator === null || !coordinator.isScopeCurrent(scope)) return
    const request = coordinator.begin(slot, scope)
    setBusy(true); setError(null)
    try {
      await run(request)
    } catch (failure) {
      if (request.isCurrent()) setError(failure instanceof Error ? failure.message : "Studio action failed")
    } finally {
      const current = request.isCurrent()
      request.finish()
      if (current) setBusy(false)
    }
  }
  const visible = stateScope === scope && requests.current.isScopeCurrent(scope)
  return <StudioView
    key={scope}
    brandName={props.brandName}
    definitions={visible ? definitions : []}
    options={visible ? options : []}
    operations={visible ? operations : []}
    quote={visible ? quote : null}
    busy={visible ? busy : true}
    error={visible ? error : null}
    onInputChanged={() => {
      quoteRequest.current += 1
      setQuote(null)
    }}
    onQuote={(operationInput, inputRevision) => void action("control", async (request) => {
      const quoteGeneration = ++quoteRequest.current
      const response = await client.quote(operationInput, createMediaCommandIdentity(), request.signal)
      if (request.isCurrent() && quoteGeneration === quoteRequest.current) {
        setQuote({ ...response.quote.estimate, expiresAt: response.quote.expiresAt, inputRevision })
      }
    })}
    onSubmit={(operationInput) => void action("control", async (request) => {
      const command = createMediaCommandIdentity()
      const recovery = recoveryStore()
      recovery.remember({ kind: "submit", command, createdAt: new Date().toISOString() })
      setRecoveryRevision((current) => current + 1)
      const response = await client.submit(operationInput, command, request.signal)
      await reconcileCommand(response, request.signal)
      if (request.isCurrent()) setQuote(null)
    })}
    onCancel={(operation) => void action("control", async (request) => {
      const command = createMediaCommandIdentity()
      const recovery = recoveryStore()
      recovery.remember({ kind: "cancel", command, createdAt: new Date().toISOString() })
      setRecoveryRevision((current) => current + 1)
      const response = await client.cancel(operation.mediaOperationRef, { expectedOwnerVersion: operation.ownerVersion }, command, request.signal)
      await reconcileCommand(response, request.signal)
    })}
    onRefresh={() => void action("control", ({ signal }) => refresh(signal))}
  />
}

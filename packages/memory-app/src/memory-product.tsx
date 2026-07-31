"use client"

import type {
  MemoryCategory,
  MemoryCommandKind,
  MemoryCommandResponse,
  MemoryEntryActiveView,
  MemoryEntryView,
  MemoryImportStatus,
  MemoryRevisionView,
  MemorySettings,
} from "@kokoro/site-client"
import {
  createAssetUploader,
  createLocalAssetRecoveryStore,
  type AssetUploadProgress,
} from "@kokoro/asset-client"
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  beginMemorySelection,
  createMemoryBrowserClient,
  createMemoryCommandIdentity,
  createMemoryCommandJournal,
  MemoryBrowserError,
  memoryCommandRequiresRecovery,
  memorySpacePurgeIsPending,
  mergeMemoryEntries,
  mergeMemoryHistory,
  projectMemoryCommand,
  projectMemoryReadEpoch,
  reconcileMemoryEntryPage,
  settleMemorySelection,
  type MemoryBrowserFetch,
  type BrowserMemoryExportStatus,
  type MemoryControllerState,
  type PendingMemoryCommand,
  type MemorySpacePurgeView,
} from "./memory-controller"
import styles from "./memory-product.module.css"

export const MEMORY_REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)" as const
export const MAXIMUM_MEMORY_UTF8_BYTES = 16_384 as const

export function memoryUtf8Bytes(value: string): number | null {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return null
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return null
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null
  }
  return new TextEncoder().encode(value).byteLength
}

export function safeMemoryImportLabel(filename: string): string {
  const normalized = Array.from(filename.normalize("NFC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) ? " " : character
  }).join("")
    .replace(/\s+/gu, " ")
    .trim()
  const bounded = Array.from(normalized).slice(0, 160).join("")
  return bounded === "" ? "Selected memory export" : bounded
}

export function destructiveConfirmation(kind: "forget" | "reset", value: string): boolean {
  return value === (kind === "forget" ? "FORGET" : "RESET ALL MEMORY")
}

export function restoreConflictMessage(input: Readonly<{ expectedRevision: number; currentRevision: number }>): string {
  return `This memory changed from revision ${input.expectedRevision} to ${input.currentRevision}. Review the current memory before restoring.`
}

function availabilityLabel(availability: string): string {
  switch (availability) {
    case "available": return "Available"
    case "unavailable_until_session_m1a": return "Past-chat reference is not available in this release."
    case "unavailable_until_memory_m3": return "Automatic learning is not available in this release."
    default: return "Unavailable"
  }
}

function categoryLabel(category: MemoryCategory): string {
  switch (category) {
    case "profile": return "Profile"
    case "preference": return "Preference"
    case "fact": return "Fact"
    case "project_fact": return "Project fact"
  }
}

function exportLabel(item: BrowserMemoryExportStatus): string {
  switch (item.state) {
    case "queued": return "Queued"
    case "running": return "Preparing export"
    case "ready": return "Ready for authorized delivery"
    case "failed": return "Export failed"
    case "expired": return "Export expired"
    case "purged": return "Export purged"
  }
}

function importLabel(item: MemoryImportStatus): string {
  if (item.safeStatusCode === "awaiting_review") return "Awaiting review"
  switch (item.state) {
    case "queued": return "Queued"
    case "validating": return "Validating"
    case "quarantined": return "Quarantined"
    case "applying": return "Applying"
    case "completed": return "Completed"
    case "rejected": return "Rejected"
    case "failed": return "Failed"
  }
}

function SettingsCard(props: Readonly<{
  title: string
  description: string
  availability: string
  effective: boolean
  policyReason: string | null
  requested: boolean
  disabled: boolean
  onChange?(value: boolean): void
}>) {
  return <article className={styles.settingCard}>
    <div><h3>{props.title}</h3><p>{props.description}</p></div>
    <div className={styles.settingState}>
      <span>Requested: {props.requested ? "On" : "Off"}</span>
      <span>Effective: {props.effective ? "On" : "Off"}</span>
    </div>
    {props.policyReason === null ? null : <p className={styles.policyReason}><strong>Policy:</strong> {props.policyReason}</p>}
    {props.availability === "available" && props.onChange !== undefined
      ? <label className={styles.toggle}><input
        aria-label={`Request ${props.title}`}
        checked={props.requested}
        disabled={props.disabled}
        onChange={(event) => props.onChange?.(event.currentTarget.checked)}
        type="checkbox"
      /><span>Change requested setting</span></label>
      : <p className={styles.unavailable}>{availabilityLabel(props.availability)}</p>}
  </article>
}

function PurgeState(props: Readonly<{ entry: Exclude<MemoryEntryView, MemoryEntryActiveView>; busy: boolean; onRefresh(): void }>) {
  return <section className={styles.detailCard} aria-live="polite">
    <span className={styles.eyebrow}>Deletion receipt</span>
    <h2>{props.entry.state === "purged" ? "Memory purged" : "Deletion in progress"}</h2>
    <p>{props.entry.state === "purged"
      ? "The owner reports that content purge is complete. This historical identity cannot be restored."
      : "This memory stopped being available immediately. Physical purge participants are still completing."}</p>
    <code>{props.entry.purgeReceiptRef}</code>
    {props.entry.state === "purged" ? null : <button disabled={props.busy} onClick={props.onRefresh} type="button">Verify purge state</button>}
  </section>
}

export type MemoryViewProps = Readonly<{
  brandName: string
  busy: boolean
  settings: MemorySettings | null
  entries: readonly MemoryEntryActiveView[]
  nextCursor: string | null
  selectedEntryRef: string | null
  selectedEntry: MemoryEntryView | null
  history: readonly MemoryRevisionView[]
  historyNextCursor: string | null
  exports: readonly BrowserMemoryExportStatus[]
  imports: readonly MemoryImportStatus[]
  pendingCommands: readonly PendingMemoryCommand[]
  spacePurge: MemorySpacePurgeView | null
  importSource: Readonly<{ safeLabel: string }> | null
  importProgress: AssetUploadProgress | null
  status: string
  error: string | null
  onToggleSavedUse(value: boolean): void
  onCreate(input: Readonly<{ category: MemoryCategory; content: string }>): void
  onSelect(entryRef: string): void
  onLoadMore(): void
  onLoadMoreHistory(): void
  onCorrect(content: string): void
  onRestore(revision: MemoryRevisionView): void
  onPrioritize(): void
  onDeprioritize(): void
  onForget(confirmation: string): void
  onReset(confirmation: string): void
  onExport(includeHistory: boolean): void
  onChooseImportFile(file: File): void
  onImport(): void
  onRefreshExport?(exportRef: string): void
  onRefreshImport?(importRef: string): void
  onRefreshSelected?(): void
  onRecover?(commandId: string): void
}>

export function MemoryView(props: MemoryViewProps) {
  const detailRef = useRef<HTMLElement | null>(null)
  const lastFocusedEntryRef = useRef<string | null>(null)
  const [createContent, setCreateContent] = useState("")
  const [createCategory, setCreateCategory] = useState<MemoryCategory>("preference")
  const [correctContent, setCorrectContent] = useState("")
  const [forgetPhrase, setForgetPhrase] = useState("")
  const [resetPhrase, setResetPhrase] = useState("")
  const createBytes = memoryUtf8Bytes(createContent)
  const correctBytes = memoryUtf8Bytes(correctContent)
  const create = (event: FormEvent) => {
    event.preventDefault()
    if (createContent.trim() === "" || createBytes === null || createBytes > MAXIMUM_MEMORY_UTF8_BYTES) return
    props.onCreate({ category: createCategory, content: createContent })
  }
  const correct = (event: FormEvent) => {
    event.preventDefault()
    if (correctContent.trim() !== "" && correctBytes !== null && correctBytes <= MAXIMUM_MEMORY_UTF8_BYTES) props.onCorrect(correctContent)
  }
  useEffect(() => {
    if (props.selectedEntryRef === null) {
      lastFocusedEntryRef.current = null
      return
    }
    if (props.selectedEntry === null || lastFocusedEntryRef.current === props.selectedEntryRef) return
    detailRef.current?.focus()
    lastFocusedEntryRef.current = props.selectedEntryRef
  }, [props.selectedEntry, props.selectedEntryRef])

  return <main aria-busy={props.busy} className={styles.productShell}>
    <header className={styles.productHeader}>
      <div><span className={styles.eyebrow}>Personalization you control</span><h1>{props.brandName} Memory</h1></div>
    </header>

    <p className={styles.intro}>Saved facts and preferences are separate from instructions and past-chat history. Every change is owned, versioned, and recoverable.</p>
    <div className={styles.liveRegion} aria-atomic="true" aria-live="polite" role="status">{props.status}</div>
    {props.error === null ? null : <p className={styles.error} role="alert">{props.error}</p>}

    <section aria-labelledby="memory-controls" className={styles.settingsGrid}>
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Independent controls</span><h2 id="memory-controls">What can be used</h2></div></div>
      {props.settings === null ? <p>Loading controls…</p> : <div className={styles.cards}>
        <SettingsCard
          availability={props.settings.savedMemoryUse.availability}
          description="Facts and preferences that you explicitly saved or imported."
          disabled={props.busy}
          effective={props.settings.savedMemoryUse.effective}
          onChange={props.onToggleSavedUse}
          policyReason={props.settings.savedMemoryUse.policyReason}
          requested={props.settings.savedMemoryUse.requested}
          title="Saved memory"
        />
        <SettingsCard
          availability={props.settings.pastChatReference.availability}
          description="Cited retrieval from conversations remains owned by Session."
          disabled
          effective={props.settings.pastChatReference.effective}
          policyReason={props.settings.pastChatReference.policyReason}
          requested={props.settings.pastChatReference.requested}
          title="Past chats"
        />
        <SettingsCard
          availability={props.settings.automaticLearning.availability}
          description="Inference from conversations is a later opt-in capability."
          disabled
          effective={props.settings.automaticLearning.effective}
          policyReason={props.settings.automaticLearning.policyReason}
          requested={props.settings.automaticLearning.requested}
          title="Automatic learning"
        />
      </div>}
    </section>

    <section className={styles.createCard} aria-labelledby="remember-title">
      <div><span className={styles.eyebrow}>Explicit command</span><h2 id="remember-title">Remember something</h2></div>
      <form onSubmit={create}>
        <label>Category<select disabled={props.busy} onChange={(event) => setCreateCategory(event.currentTarget.value as MemoryCategory)} value={createCategory}>
          <option value="profile">Profile</option><option value="preference">Preference</option><option value="fact">Fact</option><option value="project_fact">Project fact</option>
        </select></label>
        <label>Memory<textarea aria-describedby="create-memory-budget" onChange={(event) => setCreateContent(event.currentTarget.value)} required value={createContent} /></label>
        <small id="create-memory-budget" role="status">{createBytes === null ? "Text contains an invalid Unicode sequence." : `${createBytes.toLocaleString()} of ${MAXIMUM_MEMORY_UTF8_BYTES.toLocaleString()} UTF-8 bytes`}</small>
        <button disabled={props.busy || createContent.trim() === "" || createBytes === null || createBytes > MAXIMUM_MEMORY_UTF8_BYTES} type="submit">Save memory</button>
      </form>
    </section>

    <div className={styles.memoryGrid}>
      <section aria-labelledby="saved-list" className={styles.memoryRail}>
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Current owner view</span><h2 id="saved-list">Saved memories</h2></div></div>
        {props.entries.length === 0 ? <p className={styles.empty}>No saved memories are active.</p> : <ul>{props.entries.map((entry) => <li key={entry.entryRef}>
          <button aria-current={props.selectedEntryRef === entry.entryRef ? "true" : undefined} data-selected={props.selectedEntryRef === entry.entryRef} onClick={() => props.onSelect(entry.entryRef)} type="button">
            <span>{categoryLabel(entry.category)}{entry.prioritized ? " · Priority" : ""}</span><strong>{entry.content}</strong><small>{entry.source.safeLabel} · revision {entry.revision}</small>
          </button>
        </li>)}</ul>}
        {props.nextCursor === null ? null : <button disabled={props.busy} onClick={props.onLoadMore} type="button">Load more memories</button>}
      </section>

      <section aria-label="Memory detail" className={styles.detailColumn} ref={detailRef} tabIndex={-1}>
        {props.selectedEntry === null ? <p className={styles.empty}>Choose a memory to inspect its exact revision history.</p>
          : props.selectedEntry.state !== "active" ? <PurgeState busy={props.busy} entry={props.selectedEntry} onRefresh={() => props.onRefreshSelected?.()} />
            : <>
              <article className={styles.detailCard}>
                <div className={styles.detailHeading}><div><span className={styles.eyebrow}>{categoryLabel(props.selectedEntry.category)}</span><h2>Revision {props.selectedEntry.revision}</h2></div><span>{props.selectedEntry.scopeKind}</span></div>
                <p className={styles.memoryContent}>{props.selectedEntry.content}</p>
                <p>{props.selectedEntry.source.safeLabel} · {props.selectedEntry.source.state}</p>
                <div className={styles.actions}>
                  {props.selectedEntry.prioritized
                    ? <button disabled={props.busy} onClick={props.onDeprioritize} type="button">Remove priority</button>
                    : <button disabled={props.busy} onClick={props.onPrioritize} type="button">Prioritize</button>}
                </div>
                <form onSubmit={correct}>
                  <label>Correct this memory<textarea aria-describedby="correct-memory-budget" onChange={(event) => setCorrectContent(event.currentTarget.value)} required value={correctContent} /></label>
                  <small id="correct-memory-budget" role="status">{correctBytes === null ? "Text contains an invalid Unicode sequence." : `${correctBytes.toLocaleString()} of ${MAXIMUM_MEMORY_UTF8_BYTES.toLocaleString()} UTF-8 bytes`}</small>
                  <button disabled={props.busy || correctContent.trim() === "" || correctBytes === null || correctBytes > MAXIMUM_MEMORY_UTF8_BYTES} type="submit">Create corrected revision</button>
                </form>
                <details className={styles.danger}>
                  <summary>Forget this memory</summary>
                  <p>Deletion in progress starts with immediate logical revoke, then verifies physical purge.</p>
                  <label>Type FORGET<input onChange={(event) => setForgetPhrase(event.currentTarget.value)} value={forgetPhrase} /></label>
                  <button disabled={props.busy || !destructiveConfirmation("forget", forgetPhrase)} onClick={() => props.onForget(forgetPhrase)} type="button">Forget permanently</button>
                </details>
              </article>
              <section aria-labelledby="history-title" className={styles.historyCard}>
                <h2 id="history-title">Revision history</h2>
                {props.history.length === 0 ? <p>No prior revisions.</p> : <ol>{props.history.map((revision) => <li key={revision.revisionRef}>
                  <div><strong>Revision {revision.revision}</strong><span>{revision.reason}</span></div>
                  {revision.state === "available" ? <p>{revision.content}</p> : <p>Purged content</p>}
                  <button disabled={props.busy || !revision.restorable || revision.state !== "available"} onClick={() => props.onRestore(revision)} type="button">Restore as a new revision</button>
                </li>)}</ol>}
                {props.historyNextCursor === null ? null : <button disabled={props.busy} onClick={props.onLoadMoreHistory} type="button">Load more history</button>}
              </section>
            </>}
      </section>
    </div>

    <section className={styles.transferGrid} aria-labelledby="data-title">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Data rights</span><h2 id="data-title">Import and export</h2></div></div>
      <article><h3>Export</h3><p>Creates a versioned, expiring Artifact delivery request. This page never receives ciphertext or a permanent URL.</p><button disabled={props.busy} onClick={() => props.onExport(true)} type="button">Request export with history</button>
        <ul>{props.exports.map((item) => { const deliveryUrl = item.artifactDownloadRequest?.deliveryUrl; return <li key={item.exportRef}><strong>{exportLabel(item)}</strong><span>{item.exportRef}</span>{item.state === "ready" && deliveryUrl !== undefined ? <a download href={deliveryUrl}>Download authorized export</a> : null}{props.onRefreshExport === undefined || ["failed", "expired", "purged"].includes(item.state) || (item.state === "ready" && deliveryUrl !== undefined) ? null : <button disabled={props.busy} onClick={() => props.onRefreshExport?.(item.exportRef)} type="button">{item.state === "ready" ? "Authorize download" : "Refresh export"}</button>}</li> })}</ul>
      </article>
      <article><h3>Import</h3><p>Choose a Kokoro export file through this Site’s authorized Asset upload. Internal Asset references are never typed or displayed.</p>
        <label className={styles.filePicker}>Choose export file<input accept="application/json,.json" disabled={props.busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file !== undefined) props.onChooseImportFile(file) }} type="file" /></label>
        {props.importProgress === null ? null : <p role="status">{props.importProgress.phase} · {Math.round(props.importProgress.uploadedBytes / props.importProgress.totalBytes * 100)}%</p>}
        {props.importSource === null ? <p>No authorized import file selected.</p> : <><p><strong>{props.importSource.safeLabel}</strong> is ready in quarantine.</p><button disabled={props.busy} onClick={props.onImport} type="button">Request quarantined import</button></>}
        <ul>{props.imports.map((item) => <li key={item.importRef}><strong>{importLabel(item)}</strong><span>{item.acceptedEntryCount} accepted · {item.rejectedEntryCount} rejected</span>{props.onRefreshImport === undefined || ["completed", "rejected", "failed"].includes(item.state) ? null : <button disabled={props.busy} onClick={() => props.onRefreshImport?.(item.importRef)} type="button">Refresh import</button>}</li>)}</ul></article>
    </section>

    {props.spacePurge === null ? null : <section className={styles.recovery} aria-labelledby="space-purge-title" aria-live="polite">
      <span className={styles.eyebrow}>Reset receipt</span>
      <h2 id="space-purge-title">All saved memory is revoked</h2>
      <p>{props.spacePurge.purgeState === "purged" ? "Physical purge is complete" : "Physical purge is still in progress"}</p>
      <code>{props.spacePurge.purgeReceiptRef}</code>
      <time dateTime={props.spacePurge.effectiveAt}>Effective {props.spacePurge.effectiveAt}</time>
    </section>}

    {props.pendingCommands.length === 0 ? null : <section className={styles.recovery} aria-labelledby="recovery-title"><h2 id="recovery-title">Commands awaiting owner recovery</h2><ul>{props.pendingCommands.map((command) => <li key={command.commandId}><span>{command.commandKind}</span><code>{command.commandId}</code>{props.onRecover === undefined ? null : <button disabled={props.busy} onClick={() => props.onRecover?.(command.commandId)} type="button">Recover outcome</button>}</li>)}</ul></section>}

    <details className={styles.resetCard}><summary>Reset all saved memory</summary><p>This immediately revokes every active saved memory and begins receipt-backed purge. It cannot be undone.</p><label>Type RESET ALL MEMORY<input onChange={(event) => setResetPhrase(event.currentTarget.value)} value={resetPhrase} /></label><button disabled={props.busy || !destructiveConfirmation("reset", resetPhrase)} onClick={() => props.onReset(resetPhrase)} type="button">Reset all memory</button></details>
  </main>
}

const EMPTY_STATE: MemoryControllerState = Object.freeze({
  generation: 0,
  settings: null,
  entries: Object.freeze([]),
  nextCursor: null,
  selectedEntryRef: null,
  selectedEntry: null,
  history: Object.freeze([]),
  historyNextCursor: null,
  exports: Object.freeze([]),
  imports: Object.freeze([]),
  pendingCommands: Object.freeze([]),
  spacePurge: null,
})

function errorMessage(error: unknown): string {
  if (error instanceof MemoryBrowserError) {
    if (error.code === "VERSION_CONFLICT" || error.code === "version_conflict") return "This memory changed. Refresh the current revision before retrying."
    if (error.code === "OUTCOME_UNKNOWN") return "The command outcome is unknown. Recover the existing command instead of submitting it again."
    return error.message
  }
  return error instanceof Error ? error.message : "Memory is unavailable"
}

type MemoryClient = ReturnType<typeof createMemoryBrowserClient>

export type MemoryRuntimeScopeToken = Readonly<{
  browserRuntimeScope: string
  generation: number
}>

export interface MemoryRuntimeScopeFence {
  capture(): MemoryRuntimeScopeToken
  commit(browserRuntimeScope: string): MemoryRuntimeScopeToken
  isCurrent(token: MemoryRuntimeScopeToken): boolean
}

export function createMemoryRuntimeScopeFence(browserRuntimeScope: string): MemoryRuntimeScopeFence {
  let current: MemoryRuntimeScopeToken = Object.freeze({ browserRuntimeScope, generation: 0 })
  return Object.freeze({
    capture: () => current,
    commit(nextBrowserRuntimeScope: string) {
      current = Object.freeze({
        browserRuntimeScope: nextBrowserRuntimeScope,
        generation: current.generation + 1,
      })
      return current
    },
    isCurrent(token: MemoryRuntimeScopeToken) {
      return token.browserRuntimeScope === current.browserRuntimeScope && token.generation === current.generation
    },
  })
}

export function MemoryProduct(props: Readonly<{
  brandName: string
  browserRuntimeScope: string
  csrfToken: string
  initialEntryRef?: string
  fetch?: MemoryBrowserFetch
}>) {
  const [state, setState] = useState<MemoryControllerState>(EMPTY_STATE)
  const [inFlight, setInFlight] = useState(0)
  const [status, setStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const stateRef = useRef(state)
  const controllers = useRef(new Set<AbortController>())
  const scopeFenceRef = useRef(createMemoryRuntimeScopeFence(props.browserRuntimeScope))
  const assetUploadGenerationRef = useRef(0)
  const [assetUploader, setAssetUploader] = useState<ReturnType<typeof createAssetUploader> | null>(null)
  const [importSource, setImportSource] = useState<Readonly<{ assetRef: string; assetVersionRef: string; safeLabel: string }> | null>(null)
  const [importProgress, setImportProgress] = useState<AssetUploadProgress | null>(null)
  const client = useMemo(() => createMemoryBrowserClient({ csrfToken: props.csrfToken, fetch: props.fetch }), [props.csrfToken, props.fetch])
  stateRef.current = state

  const commitState = useCallback((project: (current: MemoryControllerState) => MemoryControllerState): MemoryControllerState => {
    const next = project(stateRef.current)
    stateRef.current = next
    setState(next)
    return next
  }, [])

  useLayoutEffect(() => {
    scopeFenceRef.current.commit(props.browserRuntimeScope)
    assetUploadGenerationRef.current += 1
    for (const controller of controllers.current) controller.abort("Memory runtime scope changed")
    controllers.current.clear()
  }, [client, props.browserRuntimeScope, props.initialEntryRef])

  const request = useCallback(async <Value,>(operation: (signal: AbortSignal) => Promise<Value>): Promise<Value> => {
    const controller = new AbortController()
    controllers.current.add(controller)
    setInFlight((current) => current + 1)
    try {
      return await operation(controller.signal)
    } finally {
      controllers.current.delete(controller)
      setInFlight((current) => Math.max(0, current - 1))
    }
  }, [])

  useEffect(() => {
    assetUploadGenerationRef.current += 1
    let uploader: ReturnType<typeof createAssetUploader> | null = null
    try {
      uploader = createAssetUploader({
        csrfToken: props.csrfToken,
        store: createLocalAssetRecoveryStore({ storage: window.localStorage, scope: `${props.browserRuntimeScope}:memory-import`, pruneOtherScopes: false }),
        maximumBytes: 16 * 1024 * 1024,
        maximumConcurrentUploads: 1,
      })
    } catch {
      try {
        uploader = createAssetUploader({
          csrfToken: props.csrfToken,
          store: createLocalAssetRecoveryStore({ storage: window.sessionStorage, scope: `${props.browserRuntimeScope}:memory-import`, pruneOtherScopes: false }),
          maximumBytes: 16 * 1024 * 1024,
          maximumConcurrentUploads: 1,
        })
      } catch {
        uploader = null
      }
    }
    setAssetUploader(uploader)
    return () => {
      assetUploadGenerationRef.current += 1
      uploader?.dispose()
      setAssetUploader((current) => current === uploader ? null : current)
    }
  }, [props.browserRuntimeScope, props.csrfToken])

  useEffect(() => {
    const expectedScope = scopeFenceRef.current.capture()
    let readGeneration = commitState((current) => Object.freeze({
      ...EMPTY_STATE,
      generation: current.generation + 1,
    })).generation
    setStatus("")
    setError(null)
    setImportSource(null)
    setImportProgress(null)
    void request(async (signal) => {
      const [settings, page] = await Promise.all([client.getSettings(signal), client.listEntries({ limit: 50 }, signal)])
      if (!scopeFenceRef.current.isCurrent(expectedScope) || stateRef.current.generation !== readGeneration) return
      const pendingCommands = createMemoryCommandJournal({ storage: localStorage, scope: expectedScope.browserRuntimeScope }).list()
      const loaded = commitState((current) => projectMemoryReadEpoch(current, readGeneration, (active) => Object.freeze({
        ...active,
        settings,
        entries: page.items,
        nextCursor: page.pageInfo.nextCursor,
        pendingCommands,
      })))
      if (loaded.generation !== readGeneration) return
      const initial = props.initialEntryRef
      if (initial !== undefined) {
        const selecting = commitState((current) => projectMemoryReadEpoch(current, readGeneration, (active) => beginMemorySelection(active, initial)))
        if (selecting.selectedEntryRef !== initial || selecting.generation === readGeneration) return
        readGeneration = selecting.generation
        const [entryResponse, history] = await Promise.all([client.getEntry(initial, signal), client.listHistory(initial, { limit: 50 }, signal)])
        if (!scopeFenceRef.current.isCurrent(expectedScope) || stateRef.current.generation !== readGeneration) return
        const settled = commitState((current) => projectMemoryReadEpoch(current, readGeneration, (active) => {
          const selected = settleMemorySelection(active, readGeneration, entryResponse.entry, history.items)
          return selected === active ? active : Object.freeze({ ...selected, historyNextCursor: history.pageInfo.nextCursor })
        }))
        if (settled.generation !== readGeneration) return
      }
      if (!scopeFenceRef.current.isCurrent(expectedScope) || stateRef.current.generation !== readGeneration) return
      setStatus("Memory controls are current")
    }).catch((cause: unknown) => {
      if (scopeFenceRef.current.isCurrent(expectedScope) && stateRef.current.generation === readGeneration && !(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause))
    })
    return () => {
      for (const controller of controllers.current) controller.abort("Memory product unmounted")
      controllers.current.clear()
    }
  }, [client, commitState, props.browserRuntimeScope, props.initialEntryRef, request])

  const select = useCallback((entryRef: string) => {
    const expectedScope = scopeFenceRef.current.capture()
    const loading = beginMemorySelection(stateRef.current, entryRef)
    const generation = loading.generation
    stateRef.current = loading
    setState(loading)
    setError(null)
    void request(async (signal) => {
      const [entryResponse, history] = await Promise.all([client.getEntry(entryRef, signal), client.listHistory(entryRef, { limit: 50 }, signal)])
      if (
        !scopeFenceRef.current.isCurrent(expectedScope) ||
        stateRef.current.generation !== generation ||
        stateRef.current.selectedEntryRef !== entryRef
      ) return
      setState((current) => Object.freeze({
        ...settleMemorySelection(current, generation, entryResponse.entry, history.items),
        historyNextCursor: history.pageInfo.nextCursor,
      }))
      setStatus(`Opened memory revision ${entryResponse.entry.state === "active" ? entryResponse.entry.revision : "receipt"}`)
    }).catch((cause: unknown) => { if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause)) })
  }, [client, request])

  const execute = useCallback(async (
    commandKind: MemoryCommandKind,
    targetRef: string | null,
    operation: (client: MemoryClient, command: ReturnType<typeof createMemoryCommandIdentity>, signal: AbortSignal) => Promise<MemoryCommandResponse>,
    recoverySemantics: Readonly<{ assetVersionRef?: string; restoredFromRevisionRef?: string }> = {},
  ) => {
    const expectedScope = scopeFenceRef.current.capture()
    const command = createMemoryCommandIdentity()
    const pending: PendingMemoryCommand = Object.freeze({ ...recoverySemantics, commandId: command.commandId, commandKind, targetRef, createdAt: new Date().toISOString() })
    let journal: ReturnType<typeof createMemoryCommandJournal> | null = null
    try {
      journal = createMemoryCommandJournal({ storage: localStorage, scope: expectedScope.browserRuntimeScope })
      journal.remember(pending)
    } catch (cause) {
      if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause))
      return
    }
    if (!scopeFenceRef.current.isCurrent(expectedScope)) return
    commitState((current) => Object.freeze({ ...current, pendingCommands: Object.freeze([...current.pendingCommands.filter(({ commandId }) => commandId !== pending.commandId), pending]) }))
    setError(null)
    try {
      const response = await request((signal) => operation(client, command, signal))
      if (!scopeFenceRef.current.isCurrent(expectedScope)) return
      const projected = commitState((current) => projectMemoryCommand(current, response))
      if (!memoryCommandRequiresRecovery(response)) journal.resolve(command.commandId)
      let priorityRefreshDeferred = false
      if (response.state === "succeeded" && (commandKind === "prioritizeMemoryEntry" || commandKind === "deprioritizeMemoryEntry")) {
        if (response.result.resultKind !== "entry" || response.result.entry.state !== "active") throw new MemoryBrowserError(502, "BFF_PROTOCOL_INVALID", "Memory response was invalid")
        const readGeneration = projected.generation
        const page = await request((signal) => client.listEntries({ limit: 50 }, signal))
        if (!scopeFenceRef.current.isCurrent(expectedScope) || stateRef.current.generation !== readGeneration) return
        const reconciled = reconcileMemoryEntryPage(stateRef.current.entries, page.items, response.result.entry)
        if (reconciled === null) {
          priorityRefreshDeferred = true
        } else {
          commitState((current) => current.generation !== readGeneration ? current : Object.freeze({
            ...current,
            entries: reconciled,
            nextCursor: page.pageInfo.nextCursor,
          }))
        }
      }
      if (!scopeFenceRef.current.isCurrent(expectedScope)) return
      if (response.state === "rejected") {
        setError(response.rejection.code === "version_conflict"
          ? "This memory changed. Review its current revision before retrying."
          : `Memory owner rejected this command: ${response.rejection.code}`)
      } else {
        setStatus(priorityRefreshDeferred
          ? "Priority is confirmed; list ordering is awaiting a current owner page"
          : memorySpacePurgeIsPending(response)
          ? "Memory is revoked; physical purge is still being reconciled"
          : response.state === "succeeded" ? "Memory owner confirmed the change" : "Memory command is being reconciled")
      }
    } catch (cause) {
      if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause))
    } finally { /* request tokens own busy state */ }
  }, [client, commitState, request])

  const active = state.selectedEntry?.state === "active" ? state.selectedEntry : null
  const commandHandlers = {
    toggle: (value: boolean) => {
      if (state.settings === null) return
      void execute("updateMemorySettings", null, (activeClient, command, signal) => activeClient.updateSettings({ expectedRevision: state.settings!.revision, savedMemoryUseRequested: value }, command, signal))
    },
    create: (input: Readonly<{ category: MemoryCategory; content: string }>) => void execute("rememberMemoryEntry", null, (activeClient, command, signal) => activeClient.remember({ category: input.category, content: input.content, validFrom: null, validTo: null }, command, signal)),
    correct: (content: string) => {
      if (active === null) return
      void execute("correctMemoryEntry", active.entryRef, (activeClient, command, signal) => activeClient.correct(active.entryRef, { content, expectedRevision: active.revision, validFrom: active.validFrom, validTo: active.validTo }, command, signal))
    },
    restore: (revision: MemoryRevisionView) => {
      if (active === null || revision.state !== "available") return
      void execute("restoreMemoryEntryRevision", active.entryRef, (activeClient, command, signal) => activeClient.restore(active.entryRef, revision.revisionRef, { expectedRevision: active.revision }, command, signal), { restoredFromRevisionRef: revision.revisionRef })
    },
    priority: (prioritized: boolean) => {
      if (active === null) return
      const kind = prioritized ? "prioritizeMemoryEntry" : "deprioritizeMemoryEntry"
      void execute(kind, active.entryRef, (activeClient, command, signal) => prioritized
        ? activeClient.prioritize(active.entryRef, { expectedEntryVersion: active.entryVersion }, command, signal)
        : activeClient.deprioritize(active.entryRef, { expectedEntryVersion: active.entryVersion }, command, signal))
    },
    forget: (confirmation: string) => {
      if (active === null || !destructiveConfirmation("forget", confirmation)) return
      void execute("forgetMemoryEntry", active.entryRef, (activeClient, command, signal) => activeClient.forget(active.entryRef, { acknowledgeIrreversiblePurge: true, expectedEntryVersion: active.entryVersion }, command, signal))
    },
    reset: (confirmation: string) => {
      if (!destructiveConfirmation("reset", confirmation)) return
      void execute("resetMemorySpace", null, (activeClient, command, signal) => activeClient.reset({ acknowledgeIrreversiblePurge: true }, command, signal))
    },
    exportMemory: (includeHistory: boolean) => void execute("requestMemoryExport", null, (activeClient, command, signal) => activeClient.requestExport({ format: "kokoro_memory_export_v1", includeHistory }, command, signal)),
    importMemory: () => {
      if (importSource === null) return
      void execute("requestMemoryImport", importSource.assetRef, (activeClient, command, signal) => activeClient.requestImport({ assetRef: importSource.assetRef, assetVersionRef: importSource.assetVersionRef, conflictPolicy: "quarantine", format: "kokoro_memory_export_v1" }, command, signal), { assetVersionRef: importSource.assetVersionRef })
    },
  }

  const loadMore = useCallback(() => {
    const expectedScope = scopeFenceRef.current.capture()
    const cursor = stateRef.current.nextCursor
    const generation = stateRef.current.generation
    if (cursor === null) return
    void request((signal) => client.listEntries({ cursor, limit: 50 }, signal)).then((page) => {
      if (!scopeFenceRef.current.isCurrent(expectedScope) || stateRef.current.generation !== generation) return
      commitState((current) => current.generation !== generation ? current : Object.freeze({ ...current, entries: mergeMemoryEntries(current.entries, page.items), nextCursor: page.pageInfo.nextCursor }))
      setStatus("Loaded more saved memories")
    }).catch((cause: unknown) => { if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause)) })
  }, [client, commitState, request])

  const loadMoreHistory = useCallback(() => {
    const expectedScope = scopeFenceRef.current.capture()
    const current = stateRef.current
    if (current.selectedEntryRef === null || current.historyNextCursor === null) return
    const entryRef = current.selectedEntryRef
    const cursor = current.historyNextCursor
    const generation = current.generation
    void request((signal) => client.listHistory(entryRef, { cursor, limit: 50 }, signal)).then((page) => {
      if (
        !scopeFenceRef.current.isCurrent(expectedScope) ||
        stateRef.current.generation !== generation ||
        stateRef.current.selectedEntryRef !== entryRef
      ) return
      commitState((latest) => latest.generation !== generation || latest.selectedEntryRef !== entryRef ? latest : Object.freeze({ ...latest, history: mergeMemoryHistory(latest.history, page.items), historyNextCursor: page.pageInfo.nextCursor }))
      setStatus("Loaded more revision history")
    }).catch((cause: unknown) => { if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause)) })
  }, [client, commitState, request])

  const recover = useCallback((commandId: string) => {
    const expectedScope = scopeFenceRef.current.capture()
    const pending = stateRef.current.pendingCommands.find((command) => command.commandId === commandId)
    if (pending === undefined) {
      setError("The exact Memory command is no longer available for recovery")
      return
    }
    void request((signal) => client.recover(pending, signal)).then((response) => {
      if (!scopeFenceRef.current.isCurrent(expectedScope)) return
      commitState((current) => projectMemoryCommand(current, response))
      if (!memoryCommandRequiresRecovery(response)) {
        createMemoryCommandJournal({ storage: localStorage, scope: expectedScope.browserRuntimeScope }).resolve(commandId)
      }
      if (response.state === "rejected") {
        setError(`Memory owner rejected this command: ${response.rejection.code}`)
        setStatus("Recovered the exact rejected Memory command outcome")
      } else {
        setStatus(memorySpacePurgeIsPending(response)
          ? "Recovered the reset receipt; physical purge is still in progress"
          : response.state === "succeeded" ? "Recovered the exact Memory command outcome" : "Command recovery is still pending")
      }
    }).catch((cause: unknown) => { if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause)) })
  }, [client, commitState, request])

  const refreshSelected = useCallback(() => {
    const entryRef = stateRef.current.selectedEntryRef
    if (entryRef !== null) select(entryRef)
  }, [select])

  const refreshExport = useCallback((exportRef: string) => {
    const expectedScope = scopeFenceRef.current.capture()
    void request((signal) => client.getExport(exportRef, signal)).then(({ export: item }) => {
      if (!scopeFenceRef.current.isCurrent(expectedScope)) return
      setState((current) => Object.freeze({ ...current, exports: Object.freeze([item, ...current.exports.filter((candidate) => candidate.exportRef !== item.exportRef)]) }))
      setStatus(`Export is ${exportLabel(item).toLowerCase()}`)
    }).catch((cause: unknown) => { if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause)) })
  }, [client, request])

  const refreshImport = useCallback((importRef: string) => {
    const expectedScope = scopeFenceRef.current.capture()
    void request((signal) => client.getImport(importRef, signal)).then(({ import: item }) => {
      if (!scopeFenceRef.current.isCurrent(expectedScope)) return
      setState((current) => Object.freeze({ ...current, imports: Object.freeze([item, ...current.imports.filter((candidate) => candidate.importRef !== item.importRef)]) }))
      setStatus(`Import is ${importLabel(item).toLowerCase()}`)
    }).catch((cause: unknown) => { if (scopeFenceRef.current.isCurrent(expectedScope)) setError(errorMessage(cause)) })
  }, [client, request])

  const chooseImportFile = useCallback((file: File) => {
    const expectedScope = scopeFenceRef.current.capture()
    const uploadGeneration = assetUploadGenerationRef.current + 1
    assetUploadGenerationRef.current = uploadGeneration
    if (assetUploader === null) {
      if (scopeFenceRef.current.isCurrent(expectedScope)) setError("Authorized Asset upload is unavailable in this browser session.")
      return
    }
    setError(null)
    setImportSource(null)
    const currentUpload = () => scopeFenceRef.current.isCurrent(expectedScope) && assetUploadGenerationRef.current === uploadGeneration
    void assetUploader.upload(file, {
      purpose: "memory-import",
      onProgress: (progress) => { if (currentUpload()) setImportProgress(progress) },
    }).then((attachment) => {
      if (!currentUpload()) return
      setImportSource(Object.freeze({
        assetRef: attachment.asset_ref,
        assetVersionRef: attachment.asset_version_ref,
        safeLabel: safeMemoryImportLabel(file.name),
      }))
      setImportProgress(null)
      setStatus("Import file is quarantined and ready for validation")
    }).catch((cause: unknown) => {
      if (!currentUpload()) return
      setImportProgress(null)
      setError(errorMessage(cause))
    })
  }, [assetUploader])

  return <MemoryView
    brandName={props.brandName}
    busy={inFlight > 0 || importProgress !== null}
    entries={state.entries}
    error={error}
    exports={state.exports}
    history={state.history}
    historyNextCursor={state.historyNextCursor}
    imports={state.imports}
    importProgress={importProgress}
    importSource={importSource}
    nextCursor={state.nextCursor}
    onCorrect={commandHandlers.correct}
    onCreate={commandHandlers.create}
    onDeprioritize={() => commandHandlers.priority(false)}
    onExport={commandHandlers.exportMemory}
    onForget={commandHandlers.forget}
    onChooseImportFile={chooseImportFile}
    onImport={commandHandlers.importMemory}
    onLoadMore={loadMore}
    onLoadMoreHistory={loadMoreHistory}
    onPrioritize={() => commandHandlers.priority(true)}
    onRecover={recover}
    onRefreshExport={refreshExport}
    onRefreshImport={refreshImport}
    onRefreshSelected={refreshSelected}
    onReset={commandHandlers.reset}
    onRestore={commandHandlers.restore}
    onSelect={select}
    onToggleSavedUse={commandHandlers.toggle}
    pendingCommands={state.pendingCommands}
    spacePurge={state.spacePurge}
    selectedEntry={state.selectedEntry}
    selectedEntryRef={state.selectedEntryRef}
    settings={state.settings}
    status={status}
  />
}

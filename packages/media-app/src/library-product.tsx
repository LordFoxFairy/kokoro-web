"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"

import {
  createMediaBrowserClient,
  type BrowserArtifactSummary,
  type BrowserArtifactVersion,
  type MediaBrowserFetch,
} from "./browser-client"
import {
  createScopedRequestCoordinator,
  type ScopedRequestHandle,
} from "./scoped-requests"
import { createVisibilityAwarePoller, type VisibilityAwarePoller } from "./visibility-poller"
import styles from "./media-product.module.css"

export function artifactDownloadUrl(contentUrl: string): string {
  return `${contentUrl.split("?", 1)[0]}?purpose=download`
}

function availability(version: BrowserArtifactVersion): string {
  switch (version.availability) {
    case "processing": return "Processing"
    case "ready": return "Ready"
    case "restricted": return "Restricted"
    case "unavailable": return "Unavailable"
    case "deleted": return "Deleted"
  }
}

function immutableIdentityMatches(left: BrowserArtifactVersion, right: BrowserArtifactVersion): boolean {
  return (
    left.artifactRef === right.artifactRef &&
    left.artifactVersionRef === right.artifactVersionRef &&
    left.versionNumber === right.versionNumber &&
    left.mediaClass === right.mediaClass &&
    left.createdAt === right.createdAt &&
    left.sourceArtifactVersionRefs.length === right.sourceArtifactVersionRefs.length &&
    left.sourceArtifactVersionRefs.every((value, index) => value === right.sourceArtifactVersionRefs[index])
  )
}

function sameOwnerFacts(left: BrowserArtifactVersion, right: BrowserArtifactVersion): boolean {
  if (!immutableIdentityMatches(left, right) || left.availability !== right.availability) return false
  switch (left.availability) {
    case "processing":
    case "deleted":
      return true
    case "ready":
      return right.availability === "ready" && left.contentUrl === right.contentUrl &&
        left.display.format === right.display.format && left.display.width === right.display.width &&
        left.display.height === right.display.height && left.display.byteSize === right.display.byteSize
    case "restricted":
    case "unavailable":
      return right.availability === left.availability &&
        left.safeFailure.code === right.safeFailure.code &&
        left.safeFailure.retryClass === right.safeFailure.retryClass &&
        left.safeFailure.safeMessage === right.safeFailure.safeMessage
  }
}

/** Keeps each immutable ArtifactVersion monotonic when concurrent browser reads complete out of order. */
export function mergeBrowserArtifactVersions(
  current: readonly BrowserArtifactVersion[],
  incoming: readonly BrowserArtifactVersion[],
): Readonly<{ versions: readonly BrowserArtifactVersion[]; madeProgress: boolean }> {
  const versionsByRef = new Map(current.map((version) => [version.artifactVersionRef, version]))
  let madeProgress = false
  for (const candidate of incoming) {
    const existing = versionsByRef.get(candidate.artifactVersionRef)
    if (existing === undefined) {
      madeProgress = true
      versionsByRef.set(candidate.artifactVersionRef, candidate)
      continue
    }
    if (!immutableIdentityMatches(existing, candidate)) {
      throw new TypeError("Artifact owner identity conflict")
    }
    const existingVersion = BigInt(existing.ownerVersion)
    const candidateVersion = BigInt(candidate.ownerVersion)
    if (candidateVersion < existingVersion) continue
    if (candidateVersion === existingVersion) {
      if (!sameOwnerFacts(existing, candidate)) throw new TypeError("Artifact owner version conflict")
      continue
    }
    if (existing.availability === "ready" && candidate.availability === "ready" && !sameOwnerFacts(existing, candidate)) {
      throw new TypeError("Artifact immutable content conflict")
    }
    madeProgress = true
    versionsByRef.set(candidate.artifactVersionRef, candidate)
  }
  const versions = [...versionsByRef.values()].sort((left, right) => {
    const leftNumber = BigInt(left.versionNumber)
    const rightNumber = BigInt(right.versionNumber)
    if (leftNumber !== rightNumber) return leftNumber > rightNumber ? -1 : 1
    return left.artifactVersionRef < right.artifactVersionRef ? -1 : left.artifactVersionRef > right.artifactVersionRef ? 1 : 0
  })
  return Object.freeze({ versions: Object.freeze(versions), madeProgress })
}

export function shouldPollArtifactVersions(
  selectedArtifactRef: string | null,
  versions: readonly BrowserArtifactVersion[],
): boolean {
  return selectedArtifactRef !== null && versions.some(({ availability: state }) => state === "processing")
}

type MediaBrowserClient = ReturnType<typeof createMediaBrowserClient>

export async function loadInitialLibraryOwner(
  client: Pick<MediaBrowserClient, "getArtifact" | "listArtifacts" | "listArtifactVersions">,
  requestedArtifactRef: string | null | undefined,
  signal: AbortSignal,
) {
  const artifactPagePromise = client.listArtifacts({ limit: 50 }, signal)
  if (requestedArtifactRef === undefined || requestedArtifactRef === null) {
    return Object.freeze({
      artifactPage: await artifactPagePromise,
      selectedArtifact: null,
      versionPage: null,
    })
  }
  const [artifactPage, exact] = await Promise.all([
    artifactPagePromise,
    client.getArtifact(requestedArtifactRef, signal),
  ])
  const versionPage = await client.listArtifactVersions(requestedArtifactRef, { limit: 50 }, signal)
  return Object.freeze({ artifactPage, selectedArtifact: exact.artifact, versionPage })
}

function appendArtifactSummaries(
  current: readonly BrowserArtifactSummary[],
  incoming: readonly BrowserArtifactSummary[],
): readonly BrowserArtifactSummary[] {
  const refs = new Set(current.map(({ artifactRef }) => artifactRef))
  return Object.freeze([...current, ...incoming.filter(({ artifactRef }) => !refs.has(artifactRef))])
}

/** Refreshes the leading cursor page without discarding exact or later-page Artifacts. */
export function mergeRefreshedArtifactSummaries(
  current: readonly BrowserArtifactSummary[],
  refreshed: readonly BrowserArtifactSummary[],
): readonly BrowserArtifactSummary[] {
  return appendArtifactSummaries(refreshed, current)
}

function ArtifactPreview(props: Readonly<{
  title: string
  version: Extract<BrowserArtifactVersion, { availability: "ready" }>
}>) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading")
  const [attempt, setAttempt] = useState(0)
  const statusId = useId()
  return <div className={styles.previewFrame} data-delivery-state={state}>
    <img
      aria-describedby={statusId}
      alt={`${props.title}, version ${props.version.versionNumber}`}
      className={styles.previewImage}
      height={props.version.display.height}
      key={attempt}
      loading="lazy"
      onError={() => setState("unavailable")}
      onLoad={() => setState("ready")}
      src={props.version.contentUrl}
      width={props.version.display.width}
    />
    <div className={styles.previewStatus} id={statusId} role="status">
      {state === "loading" ? "Loading preview…" : null}
      {state === "ready" ? <span className={styles.visuallyHidden}>Preview ready.</span> : null}
      {state === "unavailable" ? <span>Preview unavailable. <button type="button" onClick={() => { setState("loading"); setAttempt((value) => value + 1) }}>Retry</button></span> : null}
    </div>
  </div>
}

function ArtifactVersionCard(props: Readonly<{
  title: string
  version: BrowserArtifactVersion
}>) {
  const [downloadRequested, setDownloadRequested] = useState(false)
  const downloadStatusId = useId()
  const { version } = props
  return <article data-availability={version.availability}>
    {version.availability === "ready"
      ? <ArtifactPreview title={props.title} version={version} />
      : <div className={styles.previewFrame}><span role={version.availability === "processing" ? "status" : undefined}>{availability(version)}</span></div>}
    <div className={styles.versionMeta}><div><strong>Version {version.versionNumber}</strong><span>{availability(version)} · owner v{version.ownerVersion}</span></div>
      {version.availability === "ready" ? <a
        aria-describedby={downloadStatusId}
        download
        href={artifactDownloadUrl(version.contentUrl)}
        onClick={() => setDownloadRequested(true)}
      >Download</a> : null}
    </div>
    <span className={styles.downloadStatus} id={downloadStatusId} role="status">
      {downloadRequested ? "Download requested through this Site." : null}
    </span>
    {version.availability === "restricted" || version.availability === "unavailable" ? <p className={styles.safeFailure}>{version.safeFailure.safeMessage}</p> : null}
  </article>
}

export function LibraryView(props: Readonly<{
  brandName: string
  artifacts: readonly BrowserArtifactSummary[]
  versions: readonly BrowserArtifactVersion[]
  selectedArtifactRef: string | null
  artifactNextCursor: string | null
  versionNextCursor: string | null
  busy: boolean
  error: string | null
  onSelectArtifact(artifact: BrowserArtifactSummary): void
  onRefresh(): void
  onLoadMoreArtifacts(): void
  onLoadMoreVersions(): void
}>) {
  const selected = props.artifacts.find(({ artifactRef }) => artifactRef === props.selectedArtifactRef)
  return <main aria-busy={props.busy} className={styles.productShell}>
    <header className={styles.productHeader}>
      <div><span className={styles.eyebrow}>Exact owner versions</span><h1>{props.brandName} Library</h1></div>
      <nav aria-label="Media products"><a href="/">Chat</a><a href="/studio">Studio</a></nav>
    </header>
    {props.error === null ? null : <p className={styles.error} role="alert">{props.error}</p>}
    <div className={styles.libraryGrid}>
      <section className={styles.artifactRail} aria-labelledby="artifact-list">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Artifacts</span><h2 id="artifact-list">Project library</h2></div><button disabled={props.busy} onClick={props.onRefresh} type="button">Refresh</button></div>
        {props.artifacts.length === 0 ? <p className={styles.empty}>No artifacts yet.</p> : <ul>{props.artifacts.map((artifact) => {
          const active = artifact.artifactRef === props.selectedArtifactRef
          return <li key={artifact.artifactRef}><button aria-current={active ? "true" : undefined} aria-pressed={active} data-selected={active} type="button" onClick={() => props.onSelectArtifact(artifact)}><strong>{artifact.title}</strong><span>{artifact.availability}</span></button></li>
        })}</ul>}
        {props.artifactNextCursor === null ? null : <button disabled={props.busy} type="button" onClick={props.onLoadMoreArtifacts}>Load more artifacts</button>}
      </section>
      <section className={styles.versionGrid} aria-label="Artifact versions" aria-live="polite">
        {props.versions.length === 0 ? <p className={styles.empty}>Choose an artifact to inspect exact versions.</p> : props.versions.map((version) => <ArtifactVersionCard key={version.artifactVersionRef} title={selected?.title ?? "Artifact"} version={version} />)}
        {props.versionNextCursor === null ? null : <button className={styles.paginationButton} disabled={props.busy} type="button" onClick={props.onLoadMoreVersions}>Load more versions</button>}
      </section>
    </div>
  </main>
}

export function LibraryProduct(props: Readonly<{
  brandName: string
  csrfToken: string
  browserRuntimeScope: string
  initialArtifactRef?: string | null
  fetch?: MediaBrowserFetch
}>) {
  const scope = props.browserRuntimeScope
  const client = useMemo(() => createMediaBrowserClient({ fetch: props.fetch, csrfToken: props.csrfToken }), [props.fetch, props.csrfToken])
  const requests = useRef<ReturnType<typeof createScopedRequestCoordinator> | null>(null)
  if (requests.current === null) requests.current = createScopedRequestCoordinator(scope)
  const [stateScope, setStateScope] = useState(scope)
  const [artifacts, setArtifacts] = useState<readonly BrowserArtifactSummary[]>([])
  const [artifactNextCursor, setArtifactNextCursor] = useState<string | null>(null)
  const [versions, setVersions] = useState<readonly BrowserArtifactVersion[]>([])
  const [versionNextCursor, setVersionNextCursor] = useState<string | null>(null)
  const versionsSnapshot = useRef<readonly BrowserArtifactVersion[]>([])
  const [selectedArtifactRef, setSelectedArtifactRef] = useState<string | null>(null)
  const selectedArtifactRefSnapshot = useRef<string | null>(null)
  const selectedGeneration = useRef(0)
  const versionPoller = useRef<VisibilityAwarePoller | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [liveVersionError, setLiveVersionError] = useState<string | null>(null)
  const mergeVersions = useCallback((incoming: readonly BrowserArtifactVersion[]) => {
    if (!requests.current?.isScopeCurrent(scope)) return false
    const merged = mergeBrowserArtifactVersions(versionsSnapshot.current, incoming)
    versionsSnapshot.current = merged.versions
    setVersions(merged.versions)
    return merged.madeProgress
  }, [scope])
  useEffect(() => {
    const coordinator = requests.current
    if (coordinator === null) return
    coordinator.reset(scope)
    setStateScope(scope)
    setArtifacts(Object.freeze([]))
    setArtifactNextCursor(null)
    setVersions(Object.freeze([]))
    setVersionNextCursor(null)
    versionsSnapshot.current = Object.freeze([])
    setSelectedArtifactRef(null)
    selectedArtifactRefSnapshot.current = null
    selectedGeneration.current += 1
    setBusy(true)
    setError(null)
    setLiveVersionError(null)
    return () => coordinator.invalidate(scope)
  }, [scope])
  useEffect(() => {
    const coordinator = requests.current
    return () => coordinator?.stop()
  }, [])
  const refresh = async (request: ScopedRequestHandle) => {
    const selected = selectedArtifactRefSnapshot.current
    const generation = selectedGeneration.current
    const [page, versionPage] = await Promise.all([
      client.listArtifacts({ limit: 50 }, request.signal),
      selected === null ? Promise.resolve(null) : client.listArtifactVersions(selected, { limit: 50 }, request.signal),
    ])
    if (!request.isCurrent()) return
    setArtifacts((current) => mergeRefreshedArtifactSummaries(current, page.items))
    setArtifactNextCursor(page.pageInfo.nextCursor)
    if (
      versionPage !== null && selectedArtifactRefSnapshot.current === selected &&
      selectedGeneration.current === generation
    ) {
      mergeVersions(versionPage.items)
      setVersionNextCursor(versionPage.pageInfo.nextCursor)
    }
  }
  const action = async (slot: string, run: (request: ScopedRequestHandle) => Promise<void>) => {
    const coordinator = requests.current
    if (coordinator === null || !coordinator.isScopeCurrent(scope)) return
    const request = coordinator.begin(slot, scope)
    setBusy(true); setError(null)
    try {
      await run(request)
    } catch (failure) {
      if (request.isCurrent()) setError(failure instanceof Error ? failure.message : "Library action failed")
    } finally {
      const current = request.isCurrent()
      request.finish()
      if (current) setBusy(false)
    }
  }
  useEffect(() => {
    const coordinator = requests.current
    if (coordinator === null || !coordinator.isScopeCurrent(scope)) return
    const request = coordinator.begin("bootstrap", scope)
    void (async () => {
      try {
        const loaded = await loadInitialLibraryOwner(client, props.initialArtifactRef, request.signal)
        if (!request.isCurrent()) return
        const selectedArtifact = loaded.selectedArtifact
        setArtifacts(selectedArtifact === null
          ? loaded.artifactPage.items
          : appendArtifactSummaries([selectedArtifact], loaded.artifactPage.items))
        setArtifactNextCursor(loaded.artifactPage.pageInfo.nextCursor)
        if (selectedArtifact !== null && loaded.versionPage !== null) {
          selectedGeneration.current += 1
          selectedArtifactRefSnapshot.current = selectedArtifact.artifactRef
          setSelectedArtifactRef(selectedArtifact.artifactRef)
          mergeVersions(loaded.versionPage.items)
          setVersionNextCursor(loaded.versionPage.pageInfo.nextCursor)
        }
      } catch (failure) {
        if (request.isCurrent()) setError(failure instanceof Error ? failure.message : "Library is unavailable")
      } finally {
        const current = request.isCurrent()
        request.finish()
        if (current) setBusy(false)
      }
    })()
    return () => request.abort("Library bootstrap changed")
  }, [client, mergeVersions, props.initialArtifactRef, scope])
  useEffect(() => {
    const poller = createVisibilityAwarePoller({
      fetchValue: async (artifactRef, signal) => Object.freeze({
        artifactRef,
        page: await client.listArtifactVersions(artifactRef, { limit: 50 }, signal),
      }),
      onValues(values) {
        const selected = selectedArtifactRefSnapshot.current
        const value = values.find(({ artifactRef }) => artifactRef === selected)
        if (value === undefined || !requests.current?.isScopeCurrent(scope)) return false
        return mergeVersions(value.page.items)
      },
      onFailure: () => {
        if (requests.current?.isScopeCurrent(scope)) setLiveVersionError("Live artifact versions are temporarily delayed.")
      },
      onRecovery: () => {
        if (requests.current?.isScopeCurrent(scope)) setLiveVersionError(null)
      },
      initialDelayMs: 1_500,
      maximumDelayMs: 24_000,
    })
    versionPoller.current = poller
    return () => {
      poller.stop()
      if (versionPoller.current === poller) versionPoller.current = null
    }
  }, [client, mergeVersions, scope])
  useEffect(() => {
    const activeRef = shouldPollArtifactVersions(selectedArtifactRef, versions) ? selectedArtifactRef : null
    versionPoller.current?.setKeys(activeRef === null ? [] : [activeRef])
  }, [selectedArtifactRef, versions])
  const visible = stateScope === scope && requests.current.isScopeCurrent(scope)
  return <LibraryView
    brandName={props.brandName}
    artifacts={visible ? artifacts : []}
    versions={visible ? versions : []}
    selectedArtifactRef={visible ? selectedArtifactRef : null}
    artifactNextCursor={visible ? artifactNextCursor : null}
    versionNextCursor={visible ? versionNextCursor : null}
    busy={visible ? busy : true}
    error={visible ? error ?? liveVersionError : null}
    onRefresh={() => void action("library-owner-read", refresh)}
    onSelectArtifact={(artifact) => void action("library-owner-read", async (request) => {
      const generation = ++selectedGeneration.current
      selectedArtifactRefSnapshot.current = artifact.artifactRef
      setSelectedArtifactRef(artifact.artifactRef)
      setVersions(Object.freeze([]))
      setVersionNextCursor(null)
      versionsSnapshot.current = Object.freeze([])
      const page = await client.listArtifactVersions(artifact.artifactRef, { limit: 50 }, request.signal)
      if (
        request.isCurrent() && selectedArtifactRefSnapshot.current === artifact.artifactRef &&
        selectedGeneration.current === generation
      ) {
        mergeVersions(page.items)
        setVersionNextCursor(page.pageInfo.nextCursor)
      }
    })}
    onLoadMoreArtifacts={() => void action("library-owner-read", async (request) => {
      if (artifactNextCursor === null) return
      const page = await client.listArtifacts({ cursor: artifactNextCursor, limit: 50 }, request.signal)
      if (!request.isCurrent()) return
      setArtifacts((current) => appendArtifactSummaries(current, page.items))
      setArtifactNextCursor(page.pageInfo.nextCursor)
    })}
    onLoadMoreVersions={() => void action("library-owner-read", async (request) => {
      const artifactRef = selectedArtifactRefSnapshot.current
      const generation = selectedGeneration.current
      if (artifactRef === null || versionNextCursor === null) return
      const page = await client.listArtifactVersions(artifactRef, { cursor: versionNextCursor, limit: 50 }, request.signal)
      if (
        !request.isCurrent() || selectedArtifactRefSnapshot.current !== artifactRef ||
        selectedGeneration.current !== generation
      ) return
      mergeVersions(page.items)
      setVersionNextCursor(page.pageInfo.nextCursor)
    })}
  />
}

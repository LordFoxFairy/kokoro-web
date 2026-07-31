"use client"

import { useEffect, useMemo, useRef, useState } from "react"

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
import styles from "./media-product.module.css"

function downloadUrl(contentUrl: string): string {
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

export function LibraryView(props: Readonly<{
  brandName: string
  artifacts: readonly BrowserArtifactSummary[]
  versions: readonly BrowserArtifactVersion[]
  busy: boolean
  error: string | null
  onSelectArtifact(artifact: BrowserArtifactSummary): void
  onRefresh(): void
}>) {
  return <main className={styles.productShell}>
    <header className={styles.productHeader}>
      <div><span className={styles.eyebrow}>Exact owner versions</span><h1>{props.brandName} Library</h1></div>
      <nav aria-label="Media products"><a href="/">Chat</a><a href="/studio">Studio</a></nav>
    </header>
    {props.error === null ? null : <p className={styles.error} role="alert">{props.error}</p>}
    <div className={styles.libraryGrid}>
      <section className={styles.artifactRail} aria-labelledby="artifact-list">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Artifacts</span><h2 id="artifact-list">Project library</h2></div><button disabled={props.busy} onClick={props.onRefresh} type="button">Refresh</button></div>
        {props.artifacts.length === 0 ? <p className={styles.empty}>No artifacts yet.</p> : <ul>{props.artifacts.map((artifact) => <li key={artifact.artifactRef}><button type="button" onClick={() => props.onSelectArtifact(artifact)}><strong>{artifact.title}</strong><span>{artifact.availability}</span></button></li>)}</ul>}
      </section>
      <section className={styles.versionGrid} aria-label="Artifact versions">
        {props.versions.length === 0 ? <p className={styles.empty}>Choose an artifact to inspect exact versions.</p> : props.versions.map((version) => <article key={version.artifactVersionRef} data-availability={version.availability}>
          <div className={styles.previewFrame}>{version.availability === "ready"
            ? <img alt={`Artifact version ${version.versionNumber}`} height={version.display.height} loading="lazy" src={version.contentUrl} width={version.display.width} />
            : <span>{availability(version)}</span>}</div>
          <div className={styles.versionMeta}><div><strong>Version {version.versionNumber}</strong><span>{availability(version)} · owner v{version.ownerVersion}</span></div>
            {version.availability === "ready" ? <a href={downloadUrl(version.contentUrl)}>Download</a> : null}
          </div>
          {version.availability === "restricted" || version.availability === "unavailable" ? <p className={styles.safeFailure}>{version.safeFailure.safeMessage}</p> : null}
        </article>)}
      </section>
    </div>
  </main>
}

export function LibraryProduct(props: Readonly<{
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
  const [artifacts, setArtifacts] = useState<readonly BrowserArtifactSummary[]>([])
  const [versions, setVersions] = useState<readonly BrowserArtifactVersion[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const coordinator = requests.current
    if (coordinator === null) return
    coordinator.reset(scope)
    setStateScope(scope)
    setArtifacts(Object.freeze([]))
    setVersions(Object.freeze([]))
    setBusy(true)
    setError(null)
    return () => coordinator.invalidate(scope)
  }, [scope])
  useEffect(() => {
    const coordinator = requests.current
    return () => coordinator?.stop()
  }, [])
  const refresh = async (request: ScopedRequestHandle) => {
    const page = await client.listArtifacts({ limit: 50 }, request.signal)
    if (request.isCurrent()) setArtifacts(page.items)
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
        await refresh(request)
      } catch (failure) {
        if (request.isCurrent()) setError(failure instanceof Error ? failure.message : "Library is unavailable")
      } finally {
        const current = request.isCurrent()
        request.finish()
        if (current) setBusy(false)
      }
    })()
    return () => request.abort("Library bootstrap changed")
  }, [client, scope])
  const visible = stateScope === scope && requests.current.isScopeCurrent(scope)
  return <LibraryView
    brandName={props.brandName}
    artifacts={visible ? artifacts : []}
    versions={visible ? versions : []}
    busy={visible ? busy : true}
    error={visible ? error : null}
    onRefresh={() => void action("refresh", refresh)}
    onSelectArtifact={(artifact) => void action("selection", async (request) => {
      setVersions(Object.freeze([]))
      const page = await client.listArtifactVersions(artifact.artifactRef, { limit: 50 }, request.signal)
      if (request.isCurrent()) setVersions(page.items)
    })}
  />
}

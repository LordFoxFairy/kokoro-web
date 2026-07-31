"use client"

import { useEffect, useMemo, useState } from "react"

import {
  createMediaBrowserClient,
  type BrowserArtifactSummary,
  type BrowserArtifactVersion,
  type MediaBrowserFetch,
} from "./browser-client"
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
  fetch?: MediaBrowserFetch
}>) {
  const client = useMemo(() => createMediaBrowserClient({ fetch: props.fetch, csrfToken: props.csrfToken }), [props.fetch, props.csrfToken])
  const [artifacts, setArtifacts] = useState<readonly BrowserArtifactSummary[]>([])
  const [versions, setVersions] = useState<readonly BrowserArtifactVersion[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => {
    const page = await client.listArtifacts({ limit: 50 })
    setArtifacts(page.items)
  }
  const action = async (run: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await run() } catch (failure) { setError(failure instanceof Error ? failure.message : "Library action failed") } finally { setBusy(false) }
  }
  useEffect(() => { void action(refresh) }, [client])
  return <LibraryView
    brandName={props.brandName}
    artifacts={artifacts}
    versions={versions}
    busy={busy}
    error={error}
    onRefresh={() => void action(refresh)}
    onSelectArtifact={(artifact) => void action(async () => {
      const page = await client.listArtifactVersions(artifact.artifactRef, { limit: 50 })
      setVersions(page.items)
    })}
  />
}

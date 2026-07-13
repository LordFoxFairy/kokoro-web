"use client"

// 技能面板（WEB-SKILLS）：hub self 面的池列表/启停/配额/版本历史 + 上传 preview→confirm 两段。
// scope 恒由 BFF 从信封 namespace 派生，前端不碰身份轴。池只含「有效可用」项（official 上架∧
// 用户未关 + 自有包）；required 官方技能拒关由 hub 409 hub.skill_required 反射为锁定态。

import { useCallback, useEffect, useRef, useState } from "react"

import { useT } from "@/i18n/context"
import { HubClientError, type HubClient } from "@/hub/client"
import type { SkillCard, SkillQuota, SkillRevision, UploadCandidate } from "@/hub/schemas"

import styles from "./skills-panel.module.css"

const OFFICIAL_SCOPE = "official"

type PoolState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; skills: SkillCard[]; quota: SkillQuota | null }

type UploadState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "error" }
  | { kind: "preview"; namespace: string; candidates: UploadCandidate[]; selected: Set<string> }
  | { kind: "confirming"; namespace: string; candidates: UploadCandidate[]; selected: Set<string> }
  | { kind: "done"; results: { name: string; status: string }[] }

type SkillsPanelProps = {
  client: HubClient
  onClose: () => void
  pinned: readonly string[]
  onTogglePin: (name: string) => void
}

export function SkillsPanel({ client, onClose, pinned, onTogglePin }: SkillsPanelProps) {
  const t = useT()
  const [tab, setTab] = useState<"pool" | "upload">("pool")
  const [pool, setPool] = useState<PoolState>({ kind: "loading" })
  // required 锁定集合：某技能 disable 撞 409 hub.skill_required 后记入，UI 据此锁 toggle。
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // 纯取数（不 setState）：结果态回给调用方 setPool。挂载 effect 用 .then(setPool)（async 回调，
  // 无同步级联渲染，对齐 login-gate 的探针 idiom）。
  const loadPoolData = useCallback(async (): Promise<PoolState> => {
    try {
      const [skills, quota] = await Promise.all([
        client.listSkillPool(),
        client.skillQuota().catch(() => null),
      ])
      return { kind: "ready", skills, quota }
    } catch {
      return { kind: "error" }
    }
  }, [client])

  // 手动重取（重试/停用后/发布后）：先回 loading 态再取。仅在事件回调里调用，不在 effect 内。
  const reloadPool = useCallback(async () => {
    setPool({ kind: "loading" })
    setPool(await loadPoolData())
  }, [loadPoolData])

  useEffect(() => {
    void loadPoolData().then(setPool)
  }, [loadPoolData])

  const onDisable = useCallback(
    async (name: string) => {
      // 池内项恒为「已启用」：唯一动作是停用（停用后离池）。required 撞 409 → 锁定回滚。
      setBusy(name)
      try {
        await client.setSkillEnabled(name, false)
        await reloadPool()
      } catch (error) {
        if (error instanceof HubClientError && error.code === "hub.skill_required") {
          setLocked((prev) => new Set(prev).add(name))
        }
      } finally {
        setBusy(null)
      }
    },
    [client, reloadPool],
  )

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("skills.title")}
        className={styles.panel}
        data-testid="skills-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{t("skills.title")}</h2>
            <p className={styles.subtitle}>{t("skills.subtitle")}</p>
          </div>
          <button type="button" className={styles.close} aria-label={t("skills.close")} onClick={onClose}>
            ×
          </button>
        </header>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pool"}
            className={styles.tab}
            data-active={tab === "pool"}
            onClick={() => setTab("pool")}
          >
            {t("skills.tabPool")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
            className={styles.tab}
            data-active={tab === "upload"}
            onClick={() => setTab("upload")}
          >
            {t("skills.tabUpload")}
          </button>
        </div>

        <div className={styles.body}>
          {tab === "pool" ? (
            <PoolTab
              pool={pool}
              pinned={pinned}
              locked={locked}
              busy={busy}
              expanded={expanded}
              client={client}
              onRetry={reloadPool}
              onDisable={onDisable}
              onTogglePin={onTogglePin}
              onToggleExpand={(name) => setExpanded((prev) => (prev === name ? null : name))}
            />
          ) : (
            <UploadTab client={client} onPublished={reloadPool} />
          )}
        </div>
      </div>
    </div>
  )
}

function PoolTab({
  pool,
  pinned,
  locked,
  busy,
  expanded,
  client,
  onRetry,
  onDisable,
  onTogglePin,
  onToggleExpand,
}: {
  pool: PoolState
  pinned: readonly string[]
  locked: Set<string>
  busy: string | null
  expanded: string | null
  client: HubClient
  onRetry: () => void
  onDisable: (name: string) => void
  onTogglePin: (name: string) => void
  onToggleExpand: (name: string) => void
}) {
  const t = useT()
  if (pool.kind === "loading") {
    return <p className={styles.hint}>{t("skills.loading")}</p>
  }
  if (pool.kind === "error") {
    return (
      <div className={styles.hint}>
        <p>{t("skills.loadError")}</p>
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t("skills.retry")}
        </button>
      </div>
    )
  }
  return (
    <>
      {pool.quota ? (
        <div className={styles.quota} data-testid="skills-quota">
          <span>{t("skills.quotaPackages", { used: pool.quota.package_count, max: pool.quota.max_packages })}</span>
          <span>
            {t("skills.quotaBytes", {
              used: formatBytes(pool.quota.package_bytes),
              max: formatBytes(pool.quota.max_bytes),
            })}
          </span>
        </div>
      ) : null}

      {pool.skills.length === 0 ? (
        <p className={styles.hint}>{t("skills.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {pool.skills.map((skill) => {
            const isOfficial = skill.scope === OFFICIAL_SCOPE
            const isLocked = locked.has(skill.name)
            const isPinned = pinned.includes(skill.name)
            return (
              <li key={`${skill.scope}/${skill.name}`} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemHead}>
                    <span className={styles.name}>{skill.name}</span>
                    <span className={styles.badge} data-scope={isOfficial ? "official" : "own"}>
                      {isOfficial ? t("skills.official") : t("skills.own")}
                    </span>
                    {isLocked ? (
                      <span className={styles.badge} data-scope="required" title={t("skills.requiredTip")}>
                        {t("skills.requiredLock")}
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.desc}>{skill.description}</p>
                </div>
                <div className={styles.itemActions}>
                  <button
                    type="button"
                    className={styles.pin}
                    data-active={isPinned}
                    aria-pressed={isPinned}
                    onClick={() => onTogglePin(skill.name)}
                  >
                    {isPinned ? t("skills.unpin") : t("skills.pin")}
                  </button>
                  <button
                    type="button"
                    className={styles.ver}
                    aria-expanded={expanded === skill.name}
                    onClick={() => onToggleExpand(skill.name)}
                  >
                    {t("skills.revisions")}
                  </button>
                  <button
                    type="button"
                    className={styles.toggle}
                    disabled={isLocked || busy === skill.name}
                    onClick={() => onDisable(skill.name)}
                  >
                    {isLocked ? t("skills.requiredLock") : t("skills.disable")}
                  </button>
                </div>
                {expanded === skill.name ? <Revisions client={client} name={skill.name} /> : null}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Revisions({ client, name }: { client: HubClient; name: string }) {
  const t = useT()
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error" } | { kind: "ready"; revisions: SkillRevision[] }
  >({ kind: "loading" })
  useEffect(() => {
    let live = true
    client
      .skillRevisions(name)
      .then((revisions) => live && setState({ kind: "ready", revisions }))
      .catch(() => live && setState({ kind: "error" }))
    return () => {
      live = false
    }
  }, [client, name])
  if (state.kind === "loading") {
    return <p className={styles.revHint}>{t("skills.loading")}</p>
  }
  if (state.kind === "error") {
    return <p className={styles.revHint}>{t("skills.loadError")}</p>
  }
  if (state.revisions.length === 0) {
    return <p className={styles.revHint}>{t("skills.revEmpty")}</p>
  }
  return (
    <ul className={styles.revList}>
      {state.revisions.map((rev) => (
        <li key={rev.revision} className={styles.revRow}>
          <span>{t("skills.revLabel", { revision: rev.revision })}</span>
          <span className={styles.revMeta}>
            {rev.source} · {formatBytes(rev.package_size)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function UploadTab({ client, onPublished }: { client: HubClient; onPublished: () => void }) {
  const t = useT()
  const [state, setState] = useState<UploadState>({ kind: "idle" })
  const zipRef = useRef<Blob | null>(null)

  const onPick = useCallback(
    async (file: File) => {
      zipRef.current = file
      setState({ kind: "previewing" })
      try {
        const preview = await client.previewUpload(file)
        const selected = new Set(preview.candidates.filter((c) => c.valid).map((c) => c.name))
        setState({ kind: "preview", namespace: preview.namespace, candidates: preview.candidates, selected })
      } catch {
        setState({ kind: "error" })
      }
    },
    [client],
  )

  const onConfirm = useCallback(async () => {
    if (state.kind !== "preview" || zipRef.current === null) {
      return
    }
    const names = [...state.selected]
    setState({ kind: "confirming", namespace: state.namespace, candidates: state.candidates, selected: state.selected })
    try {
      const result = await client.confirmUpload(zipRef.current, names)
      setState({ kind: "done", results: result.results.map((r) => ({ name: r.name, status: r.status })) })
      onPublished()
    } catch {
      setState({ kind: "error" })
    }
  }, [client, onPublished, state])

  return (
    <div className={styles.upload}>
      <p className={styles.hint}>{t("skills.uploadHint")}</p>
      <input
        type="file"
        accept=".zip,application/zip"
        className={styles.file}
        aria-label={t("skills.uploadChoose")}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onPick(file)
        }}
      />

      {state.kind === "previewing" ? <p className={styles.hint}>{t("skills.uploadPreviewing")}</p> : null}
      {state.kind === "error" ? <p className={styles.error}>{t("skills.uploadError")}</p> : null}

      {state.kind === "preview" || state.kind === "confirming" ? (
        <>
          <ul className={styles.candidates}>
            {state.candidates.map((c) => (
              <li key={c.name} className={styles.candidate} data-valid={c.valid}>
                <label className={styles.candidateLabel}>
                  <input
                    type="checkbox"
                    disabled={!c.valid || state.kind === "confirming"}
                    checked={state.selected.has(c.name)}
                    onChange={(e) => {
                      if (state.kind !== "preview") return
                      const next = new Set(state.selected)
                      if (e.target.checked) next.add(c.name)
                      else next.delete(c.name)
                      setState({ ...state, selected: next })
                    }}
                  />
                  <span className={styles.name}>{c.name}</span>
                </label>
                <span className={styles.candidateMeta}>
                  {c.valid ? t("skills.candidateValid") : t("skills.candidateInvalid")}
                  {c.conflicts.namespace ? ` · ${t("skills.conflictNamespace")}` : ""}
                  {c.conflicts.official ? ` · ${t("skills.conflictOfficial")}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.publish}
            disabled={state.kind === "confirming" || state.selected.size === 0}
            onClick={onConfirm}
          >
            {state.kind === "confirming" ? t("skills.publishing") : t("skills.publish")}
          </button>
        </>
      ) : null}

      {state.kind === "done" ? (
        <ul className={styles.results}>
          {state.results.map((r) => (
            <li key={r.name} className={styles.result} data-status={r.status}>
              <span className={styles.name}>{r.name}</span>
              <span>{t(statusKey(r.status))}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function statusKey(status: string): "skills.statusPublished" | "skills.statusUnchanged" | "skills.statusFailed" {
  if (status === "published") return "skills.statusPublished"
  if (status === "unchanged") return "skills.statusUnchanged"
  return "skills.statusFailed"
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

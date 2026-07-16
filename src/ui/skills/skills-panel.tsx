"use client"

// 技能面板（WEB-SKILLS）：hub self 面的池列表/启停/配额/版本历史 + 上传 preview→confirm 两段。
// scope 恒由 BFF 从信封 namespace 派生，前端不碰身份轴。池只含「有效可用」项（official 上架∧
// 用户未关 + 自有包）；required 官方技能拒关由 hub 409 hub.skill_required 反射为锁定态。

import { useCallback, useRef, useState } from "react"

import { useT } from "@/i18n/context"
import { invalidate, useAsyncAction, useResource } from "@/lib/query"
import type { HubClient } from "@/hub/client"
import { isRequiredLockError } from "@/hub/rules"
import type { SkillCard, SkillQuota, SkillRevision, UploadCandidate } from "@/hub/schemas"

import styles from "./skills-panel.module.css"

const OFFICIAL_SCOPE = "official"
// hub 技能池查询键：启停/发布成功后 invalidate 此前缀重取（含配额，池取数合并读）。
const SKILLS_KEY = "hub/skills"

type Pool = { skills: SkillCard[]; quota: SkillQuota | null }

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
        <SkillsContent client={client} pinned={pinned} onTogglePin={onTogglePin} />
      </div>
    </div>
  )
}

type SkillsContentProps = {
  client: HubClient
  pinned: readonly string[]
  onTogglePin: (name: string) => void
}

export function SkillsContent({ client, pinned, onTogglePin }: SkillsContentProps) {
  const t = useT()
  const [tab, setTab] = useState<"pool" | "upload">("pool")
  // 池 + 配额合并读经查询层（模块缓存/去重/失活）：池只含「有效可用」项，配额缺失回退 null。
  const pool = useResource<Pool>(
    SKILLS_KEY,
    useCallback(async (): Promise<Pool> => {
      const [skills, quota] = await Promise.all([
        client.listSkillPool(),
        client.skillQuota().catch(() => null),
      ])
      return { skills, quota }
    }, [client]),
  )
  // required 锁定集合：某技能 disable 撞 409 hub.skill_required 后记入，UI 据此锁 toggle。
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const disableAction = useAsyncAction((name: string) => client.setSkillEnabled(name, false))
  const onDisable = useCallback(
    async (name: string) => {
      // 池内项恒为「已启用」：唯一动作是停用（停用后离池）。required 撞 409 → 锁定回滚。
      setBusy(name)
      const outcome = await disableAction.run(name)
      setBusy(null)
      if (outcome.ok) {
        invalidate(SKILLS_KEY) // 成功→失活重取池（离池 + 配额回收）。
      } else if (isRequiredLockError(outcome.error)) {
        setLocked((prev) => new Set(prev).add(name))
      }
    },
    [disableAction],
  )

  return (
    <>
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
              pool={pool.data ?? null}
              failed={pool.error !== undefined && pool.data === undefined}
              pinned={pinned}
              locked={locked}
              busy={busy}
              expanded={expanded}
              client={client}
              onRetry={pool.refetch}
              onDisable={onDisable}
              onTogglePin={onTogglePin}
              onToggleExpand={(name) => setExpanded((prev) => (prev === name ? null : name))}
            />
          ) : (
            <UploadTab client={client} onPublished={() => invalidate(SKILLS_KEY)} />
          )}
        </div>
    </>
  )
}

type ScopeFilter = "all" | "official" | "own"

function PoolTab({
  pool,
  failed,
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
  pool: Pool | null
  failed: boolean
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
  // 视图态:搜索词 / 范围筛选 / 停用二次确认(停用是破坏性——离池,先确认)。
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<ScopeFilter>("all")
  const [confirming, setConfirming] = useState<string | null>(null)

  // 有数据即渲染（含后台刷新期，缓存不闪空）；无数据时失败优先于 loading。
  if (pool === null) {
    if (failed) {
      return (
        <div className={styles.hint}>
          <p>{t("skills.loadError")}</p>
          <button type="button" className={styles.retry} onClick={onRetry}>
            {t("skills.retry")}
          </button>
        </div>
      )
    }
    return <p className={styles.hint}>{t("skills.loading")}</p>
  }

  const q = query.trim().toLowerCase()
  const filtered = pool.skills.filter((skill) => {
    const isOfficial = skill.scope === OFFICIAL_SCOPE
    if (scope === "official" && !isOfficial) return false
    if (scope === "own" && isOfficial) return false
    if (q !== "" && !(skill.name.toLowerCase().includes(q) || (skill.description ?? "").toLowerCase().includes(q))) {
      return false
    }
    return true
  })
  const hasSkills = pool.skills.length > 0
  const scopeFilters: ScopeFilter[] = ["all", "official", "own"]
  const scopeLabel: Record<ScopeFilter, string> = {
    all: t("skills.filterAll"),
    official: t("skills.filterOfficial"),
    own: t("skills.filterOwn"),
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

      {/* 搜索 + 范围筛选(仅有技能时出;客户端过滤,不重取)。 */}
      {hasSkills ? (
        <div className={styles.filterBar}>
          <input
            type="search"
            className={styles.search}
            value={query}
            placeholder={t("skills.searchPlaceholder")}
            aria-label={t("skills.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className={styles.filterSeg} role="group" aria-label={t("skills.filterAria")}>
            {scopeFilters.map((value) => (
              <button
                key={value}
                type="button"
                className={styles.filterBtn}
                data-active={scope === value}
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {scopeLabel[value]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!hasSkills ? (
        <div className={styles.emptyState} data-testid="skills-empty">
          <p className={styles.emptyTitle}>{t("skills.empty")}</p>
          <p className={styles.emptyGuide}>{t("skills.emptyGuide")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className={styles.hint}>{t("skills.noMatch")}</p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((skill) => {
            const isOfficial = skill.scope === OFFICIAL_SCOPE
            const isLocked = locked.has(skill.name)
            const isPinned = pinned.includes(skill.name)
            const isConfirming = confirming === skill.name
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
                  {/* 停用二次确认:首点入确认态,再点才真停用(破坏性——离池)。 */}
                  {isConfirming ? (
                    <span className={styles.confirmRow}>
                      <button
                        type="button"
                        className={styles.confirmYes}
                        disabled={busy === skill.name}
                        onClick={() => {
                          setConfirming(null)
                          onDisable(skill.name)
                        }}
                      >
                        {t("skills.confirmDisable")}
                      </button>
                      <button type="button" className={styles.confirmNo} onClick={() => setConfirming(null)}>
                        {t("skills.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={styles.toggle}
                      disabled={isLocked || busy === skill.name}
                      onClick={() => setConfirming(skill.name)}
                    >
                      {isLocked ? t("skills.requiredLock") : t("skills.disable")}
                    </button>
                  )}
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
  // 版本历史按技能名各存一份缓存键（展开即取，收起不失活——重展开即刻见旧值）。
  const revisions = useResource<SkillRevision[]>(
    `hub/skill-revisions/${name}`,
    useCallback(() => client.skillRevisions(name), [client, name]),
  )
  if (revisions.data === undefined) {
    if (revisions.error !== undefined) {
      return <p className={styles.revHint}>{t("skills.loadError")}</p>
    }
    return <p className={styles.revHint}>{t("skills.loading")}</p>
  }
  if (revisions.data.length === 0) {
    return <p className={styles.revHint}>{t("skills.revEmpty")}</p>
  }
  return (
    <ul className={styles.revList}>
      {revisions.data.map((rev) => (
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

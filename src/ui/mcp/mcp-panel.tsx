"use client"

// 连接面板（MCP-UX）：hub self 面的 MCP server 池（注册/启停/软删）+ 凭据 handle 管理
// （创建/列表/删除，值只进不出）。scope 恒由 BFF 从信封 namespace 派生，前端不碰身份轴。
// official 位只读（徽标标注），namespace 自有项可启停/软删。revision/config_hash 是内部机制，
// 不向用户呈现——只呈现「已更新」语义。hub 拒绝（mutation 门 / 私网 URL / 非法凭据引用）经错误码人话化。

import { useCallback, useState } from "react"

import { useT } from "@/i18n/context"
import { invalidate, useResource } from "@/lib/query"
import { HubClientError, type HubClient } from "@/hub/client"
import { MCP_TRANSPORTS, type McpSecret, type McpServerView, type McpTransport } from "@/hub/schemas"

import styles from "./mcp-panel.module.css"

const OFFICIAL_SCOPE = "official"
// hub MCP 查询键：server/secret 任一变更（启停/软删/注册/建删凭据）后 invalidate 此键重取。
const MCP_KEY = "hub/mcp"

type Translate = ReturnType<typeof useT>

type McpData = { servers: McpServerView[]; secrets: McpSecret[] }

type McpPanelProps = {
  client: HubClient
  onClose: () => void
}

// hub 稳定错误码 → 人话文案。非 HubClientError 或未知码回退通用失败。
function humanizeError(t: Translate, error: unknown): string {
  if (!(error instanceof HubClientError)) {
    return t("mcp.errGeneric")
  }
  switch (error.code) {
    case "capability_registration_disabled":
      return t("mcp.errMutationOff")
    case "secret_broker_disabled":
      return t("mcp.errSecretOff")
    case "hub.mcp_url_forbidden":
      return t("mcp.errUrl")
    case "hub.mcp_secret_ref_invalid":
    case "hub.mcp_secret_ref_unknown":
      return t("mcp.errSecretRef")
    case "hub.mcp_server_not_found":
      return t("mcp.errNotFound")
    case "request.invalid":
      return t("mcp.errInvalid")
    default:
      return t("mcp.errGeneric")
  }
}

function transportLabel(t: Translate, transport: McpTransport): string {
  return transport === "http" ? t("mcp.transportHttp") : t("mcp.transportStreamable")
}

export function McpPanel({ client, onClose }: McpPanelProps) {
  const t = useT()
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("mcp.title")}
        className={styles.panel}
        data-testid="mcp-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{t("mcp.title")}</h2>
            <p className={styles.subtitle}>{t("mcp.subtitle")}</p>
          </div>
          <button type="button" className={styles.close} aria-label={t("mcp.close")} onClick={onClose}>
            ×
          </button>
        </header>
        <McpContent client={client} />
      </div>
    </div>
  )
}

type McpContentProps = {
  client: HubClient
}

export function McpContent({ client }: McpContentProps) {
  const t = useT()
  const [tab, setTab] = useState<"servers" | "secrets">("servers")

  // server + secret 合并读经查询层：servers 是主体（失败即 error）；secrets 尽力而为——secret
  // broker 未配置（503 secret_broker_disabled）不该拖垮整个连接面板，容错回空池。
  const data = useResource<McpData>(
    MCP_KEY,
    useCallback(async (): Promise<McpData> => {
      const [servers, secrets] = await Promise.all([
        client.listMcpServers(),
        client.listMcpSecrets().catch(() => []),
      ])
      return { servers, secrets }
    }, [client]),
  )

  // 变更后失活重取（保持 async 签名，子组件仍可 await；invalidate 本身同步）。
  const reload = useCallback(async () => {
    invalidate(MCP_KEY)
  }, [])

  const servers = data.data?.servers ?? []
  const secrets = data.data?.secrets ?? []
  const failed = data.error !== undefined && data.data === undefined

  return (
    <>
      <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "servers"}
            className={styles.tab}
            data-active={tab === "servers"}
            onClick={() => setTab("servers")}
          >
            {t("mcp.tabServers")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "secrets"}
            className={styles.tab}
            data-active={tab === "secrets"}
            onClick={() => setTab("secrets")}
          >
            {t("mcp.tabSecrets")}
          </button>
        </div>

        <div className={styles.body}>
          {data.data === undefined ? (
            failed ? (
              <div className={styles.hint}>
                <p>{t("mcp.loadError")}</p>
                <button type="button" className={styles.retry} onClick={data.refetch}>
                  {t("mcp.retry")}
                </button>
              </div>
            ) : (
              <p className={styles.hint}>{t("mcp.loading")}</p>
            )
          ) : tab === "servers" ? (
            <ServersTab client={client} servers={servers} secrets={secrets} onChanged={reload} />
          ) : (
            <SecretsTab client={client} secrets={secrets} onChanged={reload} />
          )}
        </div>
    </>
  )
}

function ServersTab({
  client,
  servers,
  secrets,
  onChanged,
}: {
  client: HubClient
  servers: McpServerView[]
  secrets: McpSecret[]
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)

  const onToggle = useCallback(
    async (server: McpServerView) => {
      setBusy(server.name)
      setError(null)
      try {
        await client.setMcpEnabled(server.name, !server.enabled)
        await onChanged()
      } catch (err) {
        setError(humanizeError(t, err))
      } finally {
        setBusy(null)
      }
    },
    [client, onChanged, t],
  )

  const onDelete = useCallback(
    async (server: McpServerView) => {
      setBusy(server.name)
      setError(null)
      try {
        await client.deleteMcpServer(server.name)
        await onChanged()
      } catch (err) {
        setError(humanizeError(t, err))
      } finally {
        setBusy(null)
      }
    },
    [client, onChanged, t],
  )

  return (
    <>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {registering ? (
        <RegisterForm
          client={client}
          secrets={secrets}
          onCancel={() => setRegistering(false)}
          onDone={async () => {
            setRegistering(false)
            await onChanged()
          }}
        />
      ) : (
        <button type="button" className={styles.register} onClick={() => setRegistering(true)}>
          {t("mcp.register")}
        </button>
      )}

      {servers.length === 0 ? (
        <p className={styles.hint}>{t("mcp.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {servers.map((server) => {
            const isOfficial = server.scope === OFFICIAL_SCOPE
            return (
              <li key={`${server.scope}/${server.name}`} className={styles.item} data-testid="mcp-server">
                <div className={styles.itemMain}>
                  <div className={styles.itemHead}>
                    <span className={styles.name}>{server.name}</span>
                    <span className={styles.badge} data-scope={isOfficial ? "official" : "own"}>
                      {isOfficial ? t("mcp.official") : t("mcp.own")}
                    </span>
                    <span className={styles.badge} data-state={server.enabled ? "on" : "off"}>
                      {server.enabled ? t("mcp.enabledBadge") : t("mcp.disabledBadge")}
                    </span>
                  </div>
                  <p className={styles.meta}>
                    {transportLabel(t, server.transport)} · {server.url}
                  </p>
                  <p className={styles.meta}>
                    {server.allowed_tools.length === 0
                      ? t("mcp.toolsAll")
                      : t("mcp.toolsCount", { count: server.allowed_tools.length })}
                    {" · "}
                    {server.secret_ref === null ? t("mcp.credNone") : t("mcp.credBound")}
                  </p>
                </div>
                {isOfficial ? null : (
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.toggle}
                      disabled={busy === server.name}
                      onClick={() => onToggle(server)}
                    >
                      {server.enabled ? t("mcp.disable") : t("mcp.enable")}
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy === server.name}
                      onClick={() => onDelete(server)}
                    >
                      {t("mcp.delete")}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// 注册向导：name/transport/url/allowed_tools/secret 选择（既有 handle 或新建，value 只进不出）。
function RegisterForm({
  client,
  secrets,
  onCancel,
  onDone,
}: {
  client: HubClient
  secrets: McpSecret[]
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const t = useT()
  const [name, setName] = useState("")
  const [transport, setTransport] = useState<McpTransport>("streamable_http")
  const [url, setUrl] = useState("")
  const [tools, setTools] = useState("")
  // 凭据选择："none" | handle(srt_...) | "new"（新建则同表单填名值，注册前先创建换 handle）。
  const [secretChoice, setSecretChoice] = useState<string>("none")
  const [newSecretName, setNewSecretName] = useState("")
  const [newSecretValue, setNewSecretValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      // 凭据 handle 归一化：新建则先创建换句柄；secret_ref 恒为 handle:srt_... 引用或 null。
      let secretRef: string | null = null
      if (secretChoice === "new") {
        const handle = await client.createMcpSecret(newSecretName.trim(), newSecretValue)
        secretRef = `handle:${handle}`
      } else if (secretChoice !== "none") {
        secretRef = `handle:${secretChoice}`
      }
      const allowedTools = tools
        .split(",")
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0)
      await client.registerMcpServer({
        name: name.trim(),
        transport,
        url: url.trim(),
        allowed_tools: allowedTools,
        secret_ref: secretRef,
      })
      await onDone()
    } catch (err) {
      setError(humanizeError(t, err))
    } finally {
      setSubmitting(false)
    }
  }, [client, name, newSecretName, newSecretValue, onDone, secretChoice, t, tools, transport, url])

  const canSubmit =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (secretChoice !== "new" || (newSecretName.trim().length > 0 && newSecretValue.length > 0))

  return (
    <form
      className={styles.form}
      data-testid="mcp-register-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit && !submitting) void onSubmit()
      }}
    >
      <p className={styles.formTitle}>{t("mcp.registerTitle")}</p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("mcp.fieldName")}</span>
        <input
          className={styles.input}
          value={name}
          placeholder={t("mcp.fieldNamePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
        <span className={styles.fieldHint}>{t("mcp.fieldNameHint")}</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("mcp.fieldTransport")}</span>
        <select
          className={styles.input}
          value={transport}
          aria-label={t("mcp.fieldTransport")}
          onChange={(e) => setTransport(e.target.value as McpTransport)}
        >
          {MCP_TRANSPORTS.map((value) => (
            <option key={value} value={value}>
              {transportLabel(t, value)}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("mcp.fieldUrl")}</span>
        <input
          className={styles.input}
          value={url}
          placeholder={t("mcp.fieldUrlPlaceholder")}
          onChange={(e) => setUrl(e.target.value)}
        />
        <span className={styles.fieldHint}>{t("mcp.fieldUrlHint")}</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("mcp.fieldTools")}</span>
        <input
          className={styles.input}
          value={tools}
          placeholder={t("mcp.fieldToolsPlaceholder")}
          onChange={(e) => setTools(e.target.value)}
        />
        <span className={styles.fieldHint}>{t("mcp.fieldToolsHint")}</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("mcp.fieldSecret")}</span>
        <select
          className={styles.input}
          value={secretChoice}
          aria-label={t("mcp.fieldSecret")}
          onChange={(e) => setSecretChoice(e.target.value)}
        >
          <option value="none">{t("mcp.secretOptionNone")}</option>
          {secrets.map((secret) => (
            <option key={secret.handle} value={secret.handle}>
              {secret.name}
            </option>
          ))}
          <option value="new">{t("mcp.secretOptionNew")}</option>
        </select>
      </label>

      {secretChoice === "new" ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("mcp.secretName")}</span>
            <input
              className={styles.input}
              value={newSecretName}
              placeholder={t("mcp.secretNamePlaceholder")}
              onChange={(e) => setNewSecretName(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("mcp.secretValue")}</span>
            <input
              className={styles.input}
              type="password"
              value={newSecretValue}
              placeholder={t("mcp.secretValuePlaceholder")}
              onChange={(e) => setNewSecretValue(e.target.value)}
            />
            <span className={styles.fieldHint}>{t("mcp.secretValueHint")}</span>
          </label>
        </>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.formActions}>
        <button type="submit" className={styles.submit} disabled={!canSubmit || submitting}>
          {submitting ? t("mcp.submitting") : t("mcp.submit")}
        </button>
        <button type="button" className={styles.cancel} onClick={onCancel} disabled={submitting}>
          {t("mcp.cancel")}
        </button>
      </div>
    </form>
  )
}

function SecretsTab({
  client,
  secrets,
  onChanged,
}: {
  client: HubClient
  secrets: McpSecret[]
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onCreate = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      await client.createMcpSecret(name.trim(), value)
      setName("")
      setValue("")
      await onChanged()
    } catch (err) {
      setError(humanizeError(t, err))
    } finally {
      setCreating(false)
    }
  }, [client, name, onChanged, t, value])

  const onDelete = useCallback(
    async (secret: McpSecret) => {
      setBusy(secret.handle)
      setError(null)
      try {
        await client.deleteMcpSecret(secret.handle)
        await onChanged()
      } catch (err) {
        setError(humanizeError(t, err))
      } finally {
        setBusy(null)
      }
    },
    [client, onChanged, t],
  )

  const canCreate = name.trim().length > 0 && value.length > 0

  return (
    <div className={styles.secrets}>
      <p className={styles.hintLead}>{t("mcp.secretsHint")}</p>

      <form
        className={styles.form}
        data-testid="mcp-secret-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (canCreate && !creating) void onCreate()
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("mcp.secretName")}</span>
          <input
            className={styles.input}
            value={name}
            placeholder={t("mcp.secretNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("mcp.secretValue")}</span>
          <input
            className={styles.input}
            type="password"
            value={value}
            placeholder={t("mcp.secretValuePlaceholder")}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className={styles.fieldHint}>{t("mcp.secretValueHint")}</span>
        </label>
        <div className={styles.formActions}>
          <button type="submit" className={styles.submit} disabled={!canCreate || creating}>
            {creating ? t("mcp.secretCreating") : t("mcp.secretCreate")}
          </button>
        </div>
      </form>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {secrets.length === 0 ? (
        <p className={styles.hint}>{t("mcp.secretsEmpty")}</p>
      ) : (
        <ul className={styles.list}>
          {secrets.map((secret) => (
            <li key={secret.handle} className={styles.item} data-testid="mcp-secret">
              <div className={styles.itemMain}>
                <div className={styles.itemHead}>
                  <span className={styles.name}>{secret.name}</span>
                </div>
                <p className={styles.meta}>
                  {t("mcp.secretCreatedAt", { date: new Date(secret.createdAt).toLocaleDateString() })}
                </p>
              </div>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busy === secret.handle}
                  onClick={() => onDelete(secret)}
                >
                  {t("mcp.secretDelete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

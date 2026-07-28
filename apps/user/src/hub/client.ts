// hub self 面 HTTP 客户端：同源 `/api/hub/*` BFF 代理（注入 web-bff 凭据 + 信封 scope/user）。
// 入站过 Zod，失败以类型化错误上抛；错误体尽力取 hub 错误码（如 hub.skill_required）供 UI 本地化。
// upload 遇到 BFF 428 时只调一次零 body session-state refresh，且最多重试一次原 FormData。

import { z, ZodError, type ZodTypeAny } from "zod"

import {
  HUB_BASE,
  hubDataSchema,
  hubErrorSchema,
  mcpDisablePath,
  mcpEnablePath,
  mcpSecretCreatedSchema,
  mcpSecretListSchema,
  mcpSecretPath,
  mcpSecretsPath,
  mcpServerPath,
  mcpServerPoolSchema,
  mcpServerRegisteredSchema,
  mcpServersPath,
  skillDisablePath,
  skillEnablePath,
  skillPoolPath,
  skillPoolSchema,
  skillQuotaPath,
  skillQuotaSchema,
  skillRevisionsPath,
  skillRevisionsSchema,
  skillUploadConfirmPath,
  skillUploadPreviewPath,
  uploadConfirmSchema,
  uploadPreviewSchema,
  type McpRegisterInput,
  type McpSecret,
  type McpServerView,
  type SkillCard,
  type SkillQuota,
  type SkillRevision,
  type UploadConfirm,
  type UploadPreview,
} from "./schemas"

export type HubFailureReason = "network" | "http" | "parse"

export class HubClientError extends Error {
  readonly reason: HubFailureReason
  // hub 稳定错误码（http 失败时尽力解析）：如 hub.skill_required / capability_registration_disabled。
  readonly code: string | null
  readonly status: number | null

  constructor(reason: HubFailureReason, message: string, code: string | null, status: number | null) {
    super(message)
    this.name = "HubClientError"
    this.reason = reason
    this.code = code
    this.status = status
  }
}

function describeUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readError(response: Response): Promise<HubClientError> {
  let code: string | null = null
  let message = `hub request failed with status ${response.status}`
  try {
    const parsed = hubErrorSchema.safeParse(await response.json())
    if (parsed.success) {
      code = parsed.data.error.code
      message = parsed.data.error.message || message
    }
  } catch {
    // 无 JSON 错误体：保留状态码描述。
  }
  return new HubClientError("http", message, code, response.status)
}

async function parseData<T extends ZodTypeAny>(response: Response, inner: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await response.json()
  } catch (error) {
    throw new HubClientError("parse", describeUnknown(error), null, response.status)
  }
  try {
    return hubDataSchema(inner).parse(raw).data
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HubClientError("parse", error.message, null, response.status)
    }
    throw error
  }
}

async function requestData<T extends ZodTypeAny>(
  path: string,
  inner: T,
  init?: RequestInit,
  refreshUploadOnce = false,
): Promise<z.infer<T>> {
  let response: Response
  try {
    response = await fetch(`${HUB_BASE}${path}`, { cache: "no-store", ...init })
  } catch (error) {
    throw new HubClientError("network", describeUnknown(error), null, null)
  }
  if (!response.ok) {
    const failure = await readError(response)
    if (
      refreshUploadOnce &&
      failure.status === 428 &&
      failure.code === "session_refresh_required" &&
      (await refreshBrowserSession())
    ) {
      return requestData(path, inner, init, false)
    }
    throw failure
  }
  return parseData(response, inner)
}

const sessionStateSchema = z.object({ state: z.enum(["authenticated", "preview", "anonymous"]) }).strict()

async function refreshBrowserSession(): Promise<boolean> {
  const response = await fetch("/api/auth/session-state", { cache: "no-store" }).catch(() => null)
  if (response === null || !response.ok) return false
  const parsed = sessionStateSchema.safeParse(await response.json().catch(() => null))
  return parsed.success && parsed.data.state === "authenticated"
}

export type HubClient = {
  listSkillPool: () => Promise<SkillCard[]>
  skillQuota: () => Promise<SkillQuota>
  skillRevisions: (name: string) => Promise<SkillRevision[]>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  previewUpload: (zip: Blob) => Promise<UploadPreview>
  confirmUpload: (zip: Blob, names: string[] | null) => Promise<UploadConfirm>
  // MCP server 池（self 面）：列表 / 注册 / 启停 / 软删。
  listMcpServers: () => Promise<McpServerView[]>
  registerMcpServer: (input: McpRegisterInput) => Promise<McpServerView>
  setMcpEnabled: (name: string, enabled: boolean) => Promise<void>
  deleteMcpServer: (name: string) => Promise<void>
  // MCP secret handle（self 面）：列表 / 创建（值只进不出）/ 软删。
  listMcpSecrets: () => Promise<McpSecret[]>
  createMcpSecret: (name: string, value: string) => Promise<string>
  deleteMcpSecret: (handle: string) => Promise<void>
}

// 无回执体的变更请求（启停/软删）：只校验状态码，错误尽力取 hub 错误码。与 setSkillEnabled 同形。
async function mutate(path: string, method: "POST" | "DELETE"): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${HUB_BASE}${path}`, { method, cache: "no-store" })
  } catch (error) {
    throw new HubClientError("network", describeUnknown(error), null, null)
  }
  if (!response.ok) {
    throw await readError(response)
  }
}

const JSON_HEADERS = { "content-type": "application/json" } as const

function uploadForm(zip: Blob, names: string[] | null): FormData {
  const form = new FormData()
  // hub upload-routes 读 multipart「file」字段为 zip；names 是 JSON 数组字符串字段（选择发布，缺省=全部）。
  form.set("file", zip, "skills.zip")
  if (names !== null) {
    form.set("names", JSON.stringify(names))
  }
  return form
}

export function createHubClient(): HubClient {
  return {
    listSkillPool: async () => (await requestData(skillPoolPath, skillPoolSchema)).skills,
    skillQuota: () => requestData(skillQuotaPath, skillQuotaSchema),
    skillRevisions: async (name) =>
      (await requestData(skillRevisionsPath(name), skillRevisionsSchema)).revisions,
    setSkillEnabled: async (name, enabled) => {
      const path = enabled ? skillEnablePath(name) : skillDisablePath(name)
      let response: Response
      try {
        response = await fetch(`${HUB_BASE}${path}`, { method: "POST", cache: "no-store" })
      } catch (error) {
        throw new HubClientError("network", describeUnknown(error), null, null)
      }
      if (!response.ok) {
        throw await readError(response)
      }
    },
    previewUpload: (zip) =>
      requestData(skillUploadPreviewPath, uploadPreviewSchema, {
        method: "POST",
        body: uploadForm(zip, null),
      }, true),
    confirmUpload: (zip, names) =>
      requestData(skillUploadConfirmPath, uploadConfirmSchema, {
        method: "POST",
        body: uploadForm(zip, names),
      }, true),
    listMcpServers: async () => (await requestData(mcpServersPath, mcpServerPoolSchema)).servers,
    registerMcpServer: async (input) =>
      (
        await requestData(mcpServersPath, mcpServerRegisteredSchema, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(
            input.secret_ref === null
              ? { name: input.name, transport: input.transport, url: input.url, allowed_tools: input.allowed_tools }
              : {
                  name: input.name,
                  transport: input.transport,
                  url: input.url,
                  allowed_tools: input.allowed_tools,
                  secret_ref: input.secret_ref,
                },
          ),
        })
      ).server,
    setMcpEnabled: (name, enabled) => mutate(enabled ? mcpEnablePath(name) : mcpDisablePath(name), "POST"),
    deleteMcpServer: (name) => mutate(mcpServerPath(name), "DELETE"),
    listMcpSecrets: async () => (await requestData(mcpSecretsPath, mcpSecretListSchema)).secrets,
    createMcpSecret: async (name, value) =>
      (
        await requestData(mcpSecretsPath, mcpSecretCreatedSchema, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name, value }),
        })
      ).handle,
    deleteMcpSecret: (handle) => mutate(mcpSecretPath(handle), "DELETE"),
  }
}

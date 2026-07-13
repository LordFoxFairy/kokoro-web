// hub self 面 HTTP 客户端：同源 `/api/hub/*` BFF 代理（注入 web-bff 凭据 + 信封 scope/user）。
// 入站过 Zod，失败以类型化错误上抛；错误体尽力取 hub 错误码（如 hub.skill_required）供 UI 本地化。

import { ZodError, type ZodTypeAny, type z } from "zod"

import {
  HUB_BASE,
  hubDataSchema,
  hubErrorSchema,
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
): Promise<z.infer<T>> {
  let response: Response
  try {
    response = await fetch(`${HUB_BASE}${path}`, { cache: "no-store", ...init })
  } catch (error) {
    throw new HubClientError("network", describeUnknown(error), null, null)
  }
  if (!response.ok) {
    throw await readError(response)
  }
  return parseData(response, inner)
}

export type HubClient = {
  listSkillPool: () => Promise<SkillCard[]>
  skillQuota: () => Promise<SkillQuota>
  skillRevisions: (name: string) => Promise<SkillRevision[]>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  previewUpload: (zip: Blob) => Promise<UploadPreview>
  confirmUpload: (zip: Blob, names: string[] | null) => Promise<UploadConfirm>
}

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
      }),
    confirmUpload: (zip, names) =>
      requestData(skillUploadConfirmPath, uploadConfirmSchema, {
        method: "POST",
        body: uploadForm(zip, names),
      }),
  }
}

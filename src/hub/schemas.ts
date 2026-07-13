// hub self 面响应契约（web 侧镜像）：hub DTO 不在冻结契约内，这里就近以 Zod 收边界。
// 全部入站过 schema，失败 fail-loud（不静默降级）。响应包统一 { data, requestId? }；
// 错误包 { error: { code, message } }。

import { z } from "zod"

// —— 成功/错误信封 ——

export const hubErrorSchema = z
  .object({
    error: z.object({ code: z.string().min(1), message: z.string() }).passthrough(),
    requestId: z.string().optional(),
  })
  .passthrough()

export function hubDataSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.object({ data: inner, requestId: z.string().optional() }).passthrough()
}

// —— 技能池 ——

// 池卡片：official 位（scope=OFFICIAL_SCOPE）与本 namespace 自有包（scope=namespace）合并视图。
// 池只含「有效可用」项（official 上架∧用户未关 + 自有包）；required 官方技能恒在且拒关（disable→409）。
export const skillCardSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    content_hash: z.string().min(1),
    scope: z.string().min(1),
  })
  .strict()
export type SkillCard = z.infer<typeof skillCardSchema>

export const skillPoolSchema = z.object({ skills: z.array(skillCardSchema) }).strict()

// —— 配额 ——

export const skillQuotaSchema = z
  .object({
    namespace: z.string().min(1),
    package_count: z.number().int(),
    package_bytes: z.number().int(),
    max_packages: z.number().int(),
    max_bytes: z.number().int(),
  })
  .strict()
export type SkillQuota = z.infer<typeof skillQuotaSchema>

// —— 版本历史 ——

export const skillRevisionSchema = z
  .object({
    scope: z.string().min(1),
    name: z.string().min(1),
    revision: z.number().int(),
    content_hash: z.string().min(1),
    package_size: z.number().int(),
    source: z.string().min(1),
    created_at: z.number().int(),
  })
  .strict()
export type SkillRevision = z.infer<typeof skillRevisionSchema>

export const skillRevisionsSchema = z.object({ revisions: z.array(skillRevisionSchema) }).strict()

// —— 上传预检 / 发布 ——

export const uploadFileEntrySchema = z
  .object({ path: z.string().min(1), size: z.number().int() })
  .strict()

export const uploadCandidateSchema = z
  .object({
    name: z.string().min(1),
    valid: z.boolean(),
    errors: z.array(z.string()),
    description: z.string().nullable(),
    content_hash: z.string().nullable(),
    package_size: z.number().int(),
    file_count: z.number().int(),
    files: z.array(uploadFileEntrySchema),
    conflicts: z.object({ official: z.boolean(), namespace: z.boolean() }).strict(),
  })
  .strict()
export type UploadCandidate = z.infer<typeof uploadCandidateSchema>

export const uploadPreviewSchema = z
  .object({ namespace: z.string().min(1), candidates: z.array(uploadCandidateSchema) })
  .strict()
export type UploadPreview = z.infer<typeof uploadPreviewSchema>

export const confirmResultSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(["published", "unchanged", "failed"]),
    revision: z.number().int().nullable(),
    content_hash: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict()
export type ConfirmResult = z.infer<typeof confirmResultSchema>

export const uploadConfirmSchema = z
  .object({ namespace: z.string().min(1), results: z.array(confirmResultSchema) })
  .strict()
export type UploadConfirm = z.infer<typeof uploadConfirmSchema>

// —— MCP server 池（self 面）——

// 传输种类：与 hub contract/mcp-storage.MCP_TRANSPORTS 对齐（http / streamable_http）。
export const MCP_TRANSPORTS = ["http", "streamable_http"] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

// 池视图：official 位（scope=official）与本 namespace 自有 server 合并。secret_ref 是引用名
// （handle:srt_... / env:VAR）非凭据本体；revision 是内部机制，UI 不呈现（仅收边界不丢字段）。
export const mcpServerViewSchema = z
  .object({
    scope: z.string().min(1),
    name: z.string().min(1),
    revision: z.number().int(),
    transport: z.enum(MCP_TRANSPORTS),
    url: z.string().min(1),
    allowed_tools: z.array(z.string()),
    secret_ref: z.string().nullable(),
    enabled: z.boolean(),
  })
  .strict()
export type McpServerView = z.infer<typeof mcpServerViewSchema>

export const mcpServerPoolSchema = z.object({ servers: z.array(mcpServerViewSchema) }).strict()
export const mcpServerRegisteredSchema = z.object({ server: mcpServerViewSchema }).strict()

// self 注册体（门后）：scope 恒取信封头（不进 body）；secret_ref 仅 handle:srt_... 引用或省略。
export type McpRegisterInput = {
  name: string
  transport: McpTransport
  url: string
  allowed_tools: string[]
  secret_ref: string | null
}

// —— MCP secret handle（self 面）——

// 列表项：句柄 + 名称 + 创建毫秒时间戳（hub SecretListItem 的 camelCase 回传）。值只进不出，绝不回显。
export const mcpSecretSchema = z
  .object({ handle: z.string().min(1), name: z.string().min(1), createdAt: z.number().int() })
  .strict()
export type McpSecret = z.infer<typeof mcpSecretSchema>

export const mcpSecretListSchema = z.object({ secrets: z.array(mcpSecretSchema) }).strict()
export const mcpSecretCreatedSchema = z.object({ handle: z.string().min(1) }).strict()

// self 面路径（浏览器同源前缀 /api/hub → BFF 前缀 /hub → hub self 面）。
export const HUB_BASE = "/api/hub"
export const mcpServersPath = "/self/mcp/servers"
export function mcpEnablePath(name: string): string {
  return `/self/mcp/servers/${encodeURIComponent(name)}/enable`
}
export function mcpDisablePath(name: string): string {
  return `/self/mcp/servers/${encodeURIComponent(name)}/disable`
}
export function mcpServerPath(name: string): string {
  return `/self/mcp/servers/${encodeURIComponent(name)}`
}
export const mcpSecretsPath = "/self/mcp/secrets"
export function mcpSecretPath(handle: string): string {
  return `/self/mcp/secrets/${encodeURIComponent(handle)}`
}
export const skillPoolPath = "/self/skills/pool"
export const skillQuotaPath = "/self/skills/quota"
export function skillEnablePath(name: string): string {
  return `/self/skills/${encodeURIComponent(name)}/enable`
}
export function skillDisablePath(name: string): string {
  return `/self/skills/${encodeURIComponent(name)}/disable`
}
export function skillRevisionsPath(name: string): string {
  return `/self/skills/${encodeURIComponent(name)}/revisions`
}
export const skillUploadPreviewPath = "/self/skills/upload/preview"
export const skillUploadConfirmPath = "/self/skills/upload/confirm"

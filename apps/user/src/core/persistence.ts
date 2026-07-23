// 落盘 Zod schema：只存 UI 偏好与会话列表索引（消息/run/暂停点真源在服务端 snapshot）。

import { z } from "zod"

import type { ConversationStore } from "./conversations"

const storedEntrySchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    updatedAt: z.number(),
    mode: z.enum(["fast", "thinking"]),
  })
  .strict()

// 输入 unknown、输出严格等于 ConversationStore：字段漂移在 typecheck 暴露；旧形状判脏重建。
export const storedConversationStoreSchema = z
  .object({
    activeId: z.string().min(1),
    conversations: z.array(storedEntrySchema),
  })
  .strict() satisfies z.ZodType<ConversationStore, z.ZodTypeDef, unknown>

export function parseStoredConversationStore(raw: unknown): ConversationStore | null {
  const result = storedConversationStoreSchema.safeParse(raw)
  return result.success ? result.data : null
}

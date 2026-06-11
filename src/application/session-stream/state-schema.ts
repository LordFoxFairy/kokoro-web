import { z } from "zod"

import type { SessionStreamState } from "./reducer"

// 持久化校验属于应用层：它守的是本地落盘的 SessionStreamState，而非线上传输载荷。
// schema 必须与 SessionStreamState 形状逐字对齐——任何字段漂移都应在 typecheck 暴露。
const storedTodoSchema = z
  .object({
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict()

const storedToolCallSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.unknown()),
    result: z.string().optional(),
    status: z.enum(["running", "done", "error"]),
    errorText: z.string().optional(),
  })
  .strict()

const storedSubagentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    subagentType: z.string().default("subagent"),
    source: z.enum(["built-in", "config-custom", "runtime-custom"]).default("built-in"),
    output: z.string().optional(),
    status: z.enum(["running", "done"]),
  })
  .strict()

// Step 的落盘形态：判别联合，逐 kind 严格校验。tool/subagent 内嵌各自的实体 schema。
const storedStepSchema = z.union([
  z
    .object({
      kind: z.literal("thinking"),
      seq: z.number(),
      messageId: z.string(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool"),
      seq: z.number(),
      messageId: z.string(),
      tool: storedToolCallSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("subagent"),
      seq: z.number(),
      messageId: z.string(),
      subagent: storedSubagentSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      seq: z.number(),
      messageId: z.string(),
    })
    .strict(),
])

// 活动字段用 .default()：缺这些字段的旧版落盘仍可解析，保持向后兼容不判脏。导出供 conversation-store 组合复用。
export const storedSessionStateSchema = z
  .object({
    // 落盘是 string[]，解析时转回内存的去重 Set（save 侧反向序列化，见 serializeSessionState）。
    seenEventIds: z.array(z.string()).transform((ids) => new Set(ids)),
    messages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["assistant", "user"]),
          content: z.string(),
          // 旧版落盘的 message 无 runId：默认补空串（不参与新 turn 分组也不判脏）。
          runId: z.string().default(""),
        })
        .strict(),
    ),
    todos: z.array(storedTodoSchema).default([]),
    stepsByRun: z.record(z.array(storedStepSchema)).default({}),
    runStatus: z.enum(["idle", "completed", "failed"]),
  })
  // 输入为 unknown（解析任意落盘数据）、输出严格等于 SessionStreamState（漂移在此暴露）。
  .strict() satisfies z.ZodType<SessionStreamState, z.ZodTypeDef, unknown>

// 解析本地持久化的会话快照：严格校验，任何不合法（多余字段/缺字段/枚举越界/类型错）
// 都返回 null 而非抛错，让调用方可以安全地降级到空首屏，绝不因脏数据崩溃。
export function parseStoredSessionState(
  raw: unknown,
): SessionStreamState | null {
  const result = storedSessionStateSchema.safeParse(raw)

  return result.success ? result.data : null
}

// 落盘前把内存的 Set 还原成 JSON 可序列化的 string[]（Set 经 JSON.stringify 会丢成 {}）。
export function serializeSessionState(
  state: SessionStreamState,
): unknown {
  return { ...state, seenEventIds: [...state.seenEventIds] }
}

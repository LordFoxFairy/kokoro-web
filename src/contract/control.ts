// GENERATED — DO NOT EDIT. Source: contract/spec/control.yaml
// Regenerate: python3 contract/generate.py

import { z } from "zod"

export const runInputSchema = z
  .object({
    message_id: z.string().min(1),
    content: z.string().min(1),
  })
  .strict()
export type RunInput = z.infer<typeof runInputSchema>

export const modelConfigSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    effort: z.string().min(1).optional(),
  })
  .strict()
export type ModelConfig = z.infer<typeof modelConfigSchema>

export const mcpServerSchema = z
  .object({
    name: z.string().min(1),
    transport: z.enum(["http", "streamable_http"]),
    url: z.string().min(1),
    allowed_tools: z.array(z.string().min(1)),
    timeout_s: z.number().int().optional(),
    headers: z.record(z.string()).optional(),
  })
  .strict()
export type McpServer = z.infer<typeof mcpServerSchema>

export const subagentDefSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    system_prompt: z.string().min(1).optional(),
    tools: z.array(z.string().min(1)),
    skills: z.array(z.string().min(1)),
    model: modelConfigSchema.optional(),
  })
  .strict()
export type SubagentDef = z.infer<typeof subagentDefSchema>

export const permissionsSchema = z
  .object({
    approval_tools: z.array(z.string().min(1)),
    review_tools: z.array(z.string().min(1)),
    subagent_create: z.enum(["deny", "ask", "allow"]),
    filesystem: z.enum(["read_only", "workspace_write"]),
  })
  .strict()
export type Permissions = z.infer<typeof permissionsSchema>

export const runtimeConfigSchema = z
  .object({
    agent_type: z.enum(["general"]),
    entry: z.string().min(1).optional(),
    model: modelConfigSchema,
    system_prompt: z.string().min(1).optional(),
    tools: z.array(z.string().min(1)),
    skills: z.array(z.string().min(1)),
    mcp: z.array(mcpServerSchema),
    subagents: z.array(subagentDefSchema),
    backend: z.enum(["state", "local_shell", "docker", "e2b", "custom"]),
    permissions: permissionsSchema,
    swarm_members: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>

export const runtimeContextSchema = z
  .object({
    namespace: z.string().min(1),
    session_id: z.string().min(1),
  })
  .strict()
export type RuntimeContext = z.infer<typeof runtimeContextSchema>

const approveDecisionSchema = z.object({ type: z.literal("approve"), tool_id: z.string().min(1), args: z.record(z.unknown()).optional() }).strict()
const editDecisionSchema = z.object({ type: z.literal("edit"), tool_id: z.string().min(1), args: z.record(z.unknown()) }).strict()
const rejectDecisionSchema = z.object({ type: z.literal("reject"), tool_id: z.string().min(1), reason: z.string().optional() }).strict()
const respondDecisionSchema = z.object({ type: z.literal("respond"), tool_id: z.string().min(1), response: z.string().min(1) }).strict()
export const resumeDecisionSchema = z.discriminatedUnion("type", [
  approveDecisionSchema,
  editDecisionSchema,
  rejectDecisionSchema,
  respondDecisionSchema,
])
export type ResumeDecision = z.infer<typeof resumeDecisionSchema>
export type ResumeDecisionType = ResumeDecision["type"]

export const runRequestSchema = z
  .object({
    kind: z.literal("run.request"),
    run_id: z.string().min(1),
    thread_id: z.string().min(1),
    input: runInputSchema,
    runtime: runtimeConfigSchema,
    context: runtimeContextSchema,
    trace: z.record(z.unknown()).optional(),
  })
  .strict()
export type RunRequest = z.infer<typeof runRequestSchema>

export const runResumeSchema = z
  .object({
    kind: z.literal("run.resume"),
    run_id: z.string().min(1),
    thread_id: z.string().min(1),
    decisions: z.array(resumeDecisionSchema).min(1),
  })
  .strict()
export type RunResume = z.infer<typeof runResumeSchema>

export const runCancelSchema = z
  .object({
    kind: z.literal("run.cancel"),
    run_id: z.string().min(1),
    thread_id: z.string().min(1),
  })
  .strict()
export type RunCancel = z.infer<typeof runCancelSchema>

export const runSteerSchema = z
  .object({
    kind: z.literal("run.steer"),
    run_id: z.string().min(1),
    thread_id: z.string().min(1),
    message_id: z.string().min(1),
    content: z.string().min(1),
  })
  .strict()
export type RunSteer = z.infer<typeof runSteerSchema>

export const inboundMessageSchema = z.discriminatedUnion("kind", [
  runRequestSchema,
  runResumeSchema,
  runCancelSchema,
  runSteerSchema,
])
export type InboundMessage = z.infer<typeof inboundMessageSchema>

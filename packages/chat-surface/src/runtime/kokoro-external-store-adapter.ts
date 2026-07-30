"use client"

import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react"

import type { ChatPart, ChatProjection, ChatProjectionMessage } from "../projection/store.js"

type ThreadMessagePartLike = Exclude<ThreadMessageLike["content"], string>[number]

export type ChatCommandPort = {
  readonly submit: (command: { readonly content: string; readonly parentId: string | null }) => Promise<void>
  readonly edit?: (command: { readonly sourceId: string; readonly content: string; readonly parentId: string | null }) => Promise<void>
  readonly reload?: (command: { readonly parentId: string | null }) => Promise<void>
  readonly cancel?: (command: { readonly runId: string }) => Promise<void>
}

function messageText(message: AppendMessage): string {
  if (message.role !== "user") throw new Error("Kokoro only accepts user composer messages")
  const unsupported = message.content.some((part) => part.type !== "text")
  if (unsupported || (message.attachments?.length ?? 0) > 0) {
    throw new Error("Attachments require an explicit Kokoro Asset command")
  }
  const text = message.content.map((part) => part.type === "text" ? part.text : "").join("").trim()
  if (!text) throw new Error("Message content is empty")
  return text
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

function jsonObject(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
}

function unreachablePart(part: never): never {
  throw new Error(`Unsupported projected part: ${JSON.stringify(part)}`)
}

function dataPart(part: Exclude<ChatPart, { kind: "text" | "reasoning-summary" | "tool" | "unsupported" }>): ThreadMessagePartLike {
  const common = { ordinal: part.ordinal, version: part.version, lifecycle: part.lifecycle }
  switch (part.kind) {
    case "citation":
      return { type: "data" as const, name: "kokoro:citation", data: {
        ...common,
        sourceRef: part.sourceRef,
        title: part.title,
        ...(part.locator === undefined ? {} : { locator: part.locator }),
        ...(part.attribution === undefined ? {} : { attribution: part.attribution }),
      } }
    case "approval":
    case "interaction":
      return { type: "data" as const, name: `kokoro:${part.kind}`, data: {
        ...common,
        ownerRef: part.ownerRef,
        expectedVersion: part.expectedVersion,
        allowedActions: [...part.allowedActions],
        status: part.status,
        ...(part.deadline === undefined ? {} : { deadline: part.deadline }),
        ...(part.receiptRef === undefined ? {} : { receiptRef: part.receiptRef }),
      } }
    case "plan":
      return { type: "data" as const, name: "kokoro:plan", data: {
        ...common,
        planProposalRef: part.planProposalRef,
        steps: part.steps.map((step) => ({ ...step })),
      } }
    case "plan-progress":
      return { type: "data" as const, name: "kokoro:plan-progress", data: {
        ...common,
        planRef: part.planRef,
        summary: part.summary,
        steps: part.steps.map((step) => ({ ...step })),
      } }
    case "subagent":
      return { type: "data" as const, name: "kokoro:subagent", data: {
        ...common,
        subagentRef: part.subagentRef,
        status: part.status,
        ...(part.summary === undefined ? {} : { summary: part.summary }),
      } }
    case "media-operation":
      return { type: "data" as const, name: "kokoro:media-operation", data: {
        ...common,
        mediaOperationRef: part.mediaOperationRef,
        capability: part.capability,
        status: part.status,
        safeMetadata: jsonObject({ ...part.safeMetadata }),
        ...(part.progressBps === undefined ? {} : { progressBps: part.progressBps }),
        ...(part.artifactRef === undefined ? {} : { artifactRef: part.artifactRef }),
      } }
    case "artifact":
      return { type: "data" as const, name: "kokoro:artifact", data: {
        ...common,
        artifactRef: part.artifactRef,
        versionRef: part.versionRef,
        ...(part.contentType === undefined ? {} : { contentType: part.contentType }),
        safeMetadata: jsonObject({ ...part.safeMetadata }),
      } }
    case "cost":
      return { type: "data" as const, name: "kokoro:cost", data: {
        ...common,
        costProjectionRef: part.costProjectionRef,
        status: part.status,
        freshness: part.freshness,
        ...(part.amount === undefined ? {} : { amount: part.amount }),
        ...(part.currencyOrCreditUnit === undefined ? {} : { currencyOrCreditUnit: part.currencyOrCreditUnit }),
      } }
    case "notice":
      return { type: "data" as const, name: "kokoro:notice", data: {
        ...common,
        noticeRef: part.noticeRef,
        code: part.code,
        message: part.message,
        severity: part.severity,
        ...(part.retryClass === undefined ? {} : { retryClass: part.retryClass }),
        ...(part.supportCorrelationRef === undefined ? {} : { supportCorrelationRef: part.supportCorrelationRef }),
      } }
    case "error":
      return { type: "data" as const, name: "kokoro:error", data: {
        ...common,
        errorRef: part.errorRef,
        code: part.code,
        message: part.message,
        retryClass: part.retryClass,
        ...(part.supportCorrelationRef === undefined ? {} : { supportCorrelationRef: part.supportCorrelationRef }),
      } }
    default:
      return unreachablePart(part)
  }
}

function convertMessage(message: ChatProjectionMessage): ThreadMessageLike {
  const content = message.parts.flatMap<ThreadMessagePartLike>((part) => {
    if (part.kind === "text") return [{ type: "text" as const, text: part.text }]
    if (part.kind === "reasoning-summary") return [{ type: "reasoning" as const, text: part.text }]
    if (part.kind === "tool") return [{
      type: "tool-call" as const,
      toolCallId: part.toolCallId,
      toolName: part.name,
      args: jsonObject(part.args),
      argsText: JSON.stringify(part.args),
      ...(part.result === undefined ? {} : { result: part.result }),
      ...(part.isError === undefined ? {} : { isError: part.isError }),
      ...(part.status === "awaiting" ? { interrupt: { type: "human" as const, payload: {
        effectRef: part.effectRef,
        receiptRef: part.receiptRef,
      } } } : {}),
    }, {
      type: "data" as const,
      name: "kokoro:tool-result-metadata",
      data: {
        toolCallId: part.toolCallId,
        ordinal: part.ordinal,
        version: part.version,
        lifecycle: part.lifecycle,
        ...(part.truncated === undefined ? {} : { truncated: part.truncated }),
        ...(part.isError === undefined ? {} : { isError: part.isError }),
      },
    }]
    if (part.kind === "unsupported") return [{
      type: "data" as const,
      name: "kokoro:unsupported",
      data: {
        originalKind: part.originalKind,
        originalSchemaVersion: part.originalSchemaVersion,
        safeFallback: part.safeFallback,
        ordinal: part.ordinal,
        version: part.version,
        lifecycle: part.lifecycle,
      },
    }]
    return [dataPart(part)]
  })
  const custom = { kokoro: { runId: message.runId, integrity: message.status } }
  if (message.role === "user") {
    return { id: message.id, role: "user", createdAt: new Date(message.createdAt), content, attachments: [], metadata: { custom } }
  }
  return {
    id: message.id,
    role: "assistant",
    createdAt: new Date(message.createdAt),
    content,
    status: message.status === "running"
      ? { type: "running" }
      : message.status === "incomplete"
        ? { type: "incomplete", reason: "other" }
        : { type: "complete", reason: "stop" },
    metadata: { custom },
  }
}

export function createKokoroExternalStoreAdapter(
  projection: ChatProjection,
  commands: ChatCommandPort,
): ExternalStoreAdapter<ChatProjectionMessage> {
  return {
    messages: projection.messages,
    convertMessage,
    isRunning: projection.activeRunId !== null,
    isLoading: projection.connection.kind === "connecting" || projection.connection.kind === "reconnecting",
    isSendDisabled: projection.repair.required || projection.connection.kind === "auth_required" || projection.command.state === "pending",
    extras: {
      kokoro: {
        connection: projection.connection,
        command: projection.command,
        repair: projection.repair,
      },
    },
    onNew: async (message) => commands.submit({ content: messageText(message), parentId: message.parentId }),
    ...(commands.edit ? {
      onEdit: async (message: AppendMessage) => {
        if (!message.sourceId) throw new Error("Edit requires a persisted source message")
        await commands.edit?.({ sourceId: message.sourceId, content: messageText(message), parentId: message.parentId })
      },
    } : {}),
    ...(commands.reload ? {
      onReload: async (parentId: string | null) => commands.reload?.({ parentId }),
    } : {}),
    ...(commands.cancel && projection.activeRunId ? {
      onCancel: async () => commands.cancel?.({ runId: projection.activeRunId as string }),
    } : {}),
  }
}

export function useKokoroExternalStoreRuntime(
  projection: ChatProjection,
  commands: ChatCommandPort,
) {
  return useExternalStoreRuntime(createKokoroExternalStoreAdapter(projection, commands))
}

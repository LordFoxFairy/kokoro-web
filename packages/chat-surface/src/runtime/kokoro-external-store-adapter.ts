"use client"

import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react"

import type { ChatProjection, ChatProjectionMessage } from "../projection/store.js"

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

function convertMessage(message: ChatProjectionMessage): ThreadMessageLike {
  const content = message.parts.map((part) => {
    if (part.kind === "text") return { type: "text" as const, text: part.text }
    if (part.kind === "reasoning") return { type: "reasoning" as const, text: part.text }
    if (part.kind === "tool") return {
      type: "tool-call" as const,
      toolCallId: part.id,
      toolName: part.name,
      args: jsonObject(part.args),
      argsText: JSON.stringify(part.args),
      ...(part.result === undefined ? {} : { result: part.result }),
      ...(part.status === "error" ? { isError: true } : {}),
      ...(part.status === "awaiting" ? { interrupt: { type: "human" as const, payload: { owner: "kokoro-session" } } } : {}),
    }
    return { type: "data" as const, name: "kokoro:unsupported", data: { originalKind: part.originalKind } }
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

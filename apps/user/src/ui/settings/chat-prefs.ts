"use client"

// 对话偏好（WEB-FACE 面三）：缺省模型 / 缺省 agent 的本地 UI 偏好（localStorage）。null=跟随空间缺省
// （不上 wire）。settings 就地保存；工作台新对话首帧由 useComposerSelectors 读此作选择器初值——
// 发首条时预填，会话级锁语义不变（开跑后 modeLocked 锁住）。非机密、不进服务端契约。

import { z } from "zod"

import { createPersistedStore } from "@/lib/persisted-store"

const chatPrefsSchema = z
  .object({
    // wire 选择子（"provider:name"）；null/缺省=跟随空间缺省。
    model: z.string().nullable().optional(),
    // agent wire 名；null/缺省=跟随空间缺省 general。
    agent: z.string().nullable().optional(),
  })
  .strict()

export type ChatPrefs = z.infer<typeof chatPrefsSchema>

const store = createPersistedStore({
  key: "kokoro.web.chat-prefs",
  schema: chatPrefsSchema,
})

export function readChatModel(): string | null {
  return store.read()?.model ?? null
}

export function readChatAgent(): string | null {
  return store.read()?.agent ?? null
}

export function writeChatModel(value: string | null): void {
  store.write({ ...(store.read() ?? {}), model: value })
}

export function writeChatAgent(value: string | null): void {
  store.write({ ...(store.read() ?? {}), agent: value })
}

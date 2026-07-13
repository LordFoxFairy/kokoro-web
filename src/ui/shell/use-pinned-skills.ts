"use client"

// 固定技能 controller：UI 偏好，只存技能名清单（跨 tab 同步），随消息上 wire 为 pinned_skills。
// 与会话/草稿分键。选中变化即注入引擎——下一次开跑/插话随 messageCreate 上 wire。

import { useEffect, useSyncExternalStore } from "react"
import { z } from "zod"

import type { SessionEngine } from "@/engine/machine"
import { createPersistedStore } from "@/lib/persisted-store"

const EMPTY_PINNED: readonly string[] = []
const pinnedStore = createPersistedStore({
  key: "kokoro.web.pinned_skills",
  schema: z.array(z.string()),
})

export function togglePinned(name: string): void {
  const current = pinnedStore.read() ?? []
  pinnedStore.write(current.includes(name) ? current.filter((n) => n !== name) : [...current, name])
}

export function removePinned(name: string): void {
  const current = pinnedStore.read() ?? []
  if (current.includes(name)) {
    pinnedStore.write(current.filter((n) => n !== name))
  }
}

// 固定技能清单（跨 tab 同步）：读缓存稳定引用，SSR/未水合回退空；变化即注入引擎。
export function usePinnedSkills(engine: SessionEngine | null): readonly string[] {
  const pinnedSkills = useSyncExternalStore(
    pinnedStore.subscribe,
    () => pinnedStore.read() ?? EMPTY_PINNED,
    () => EMPTY_PINNED,
  )
  useEffect(() => {
    engine?.setPinnedSkills(pinnedSkills)
  }, [engine, pinnedSkills])
  return pinnedSkills
}

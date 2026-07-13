"use client"

// 未发送草稿 controller：按会话持久化（切会话/刷新都保留，in-memory useState 会丢）。空串=无草稿。
// 与会话 store 分键：逐键改动不惊动引擎、也不跨 tab 抢占（草稿是本地正在编辑态）。
// 键控派生（非 effect 同步 setState）：mounted 门控保证 SSR/水合首帧一致（服务端无 localStorage）。

import { useCallback, useState } from "react"
import { z } from "zod"

import { createPersistedStore } from "@/lib/persisted-store"

// 无活跃会话（新建未落库）时的草稿键。
const DRAFT_PENDING_KEY = "__pending__"

const draftStore = createPersistedStore({
  key: "kokoro.web.drafts",
  schema: z.record(z.string(), z.string()),
})

function readDraft(key: string): string {
  return draftStore.read()?.[key] ?? ""
}

function writeDraft(key: string, value: string): void {
  const all = draftStore.read() ?? {}
  if (value === "") {
    if (!(key in all)) return
    const { [key]: _drop, ...rest } = all
    draftStore.write(rest)
  } else {
    draftStore.write({ ...all, [key]: value })
  }
}

export type DraftController = {
  draft: string
  updateDraft: (value: string) => void
  clearDraft: () => void
}

export function useDraft(activeId: string | null, mounted: boolean): DraftController {
  const draftKey = activeId ?? DRAFT_PENDING_KEY
  const [draftEdit, setDraftEdit] = useState<{ key: string; value: string } | null>(null)
  const draft = !mounted
    ? ""
    : draftEdit !== null && draftEdit.key === draftKey
      ? draftEdit.value
      : readDraft(draftKey)

  const updateDraft = useCallback(
    (value: string) => {
      setDraftEdit({ key: draftKey, value })
      writeDraft(draftKey, value)
    },
    [draftKey],
  )

  const clearDraft = useCallback(() => {
    setDraftEdit({ key: draftKey, value: "" })
    writeDraft(draftKey, "")
  }, [draftKey])

  return { draft, updateDraft, clearDraft }
}

"use client"

// 会话清单 controller（SESS-LIST / CONV-UX）：服务端水合清单 + 乐观标题覆写 + 新建/切换/删除/重命名。
// 清单本体来自 session GET /sessions（换浏览器见同列表），localStorage 不再作真源；新建/切换/删除/
// 开跑收尾后 refresh 重取首页。活跃会话若未在服务端清单出现（新建未落库/未及刷新）合成置顶项不消失。

import { useCallback, useEffect, useRef, useState } from "react"

import { conversationTitle } from "@/core/conversations"
import type { EngineSnapshot } from "@/engine/machine"
import type { SessionEngine } from "@/engine/machine"
import { useSessionList } from "@/ui/rail/use-session-list"

import { browserListClient } from "./page-clients"

type Thread = EngineSnapshot["thread"]

export type ConversationEntry = { id: string; title: string }

export type ConversationListController = {
  conversations: ConversationEntry[]
  loading: boolean
  error: boolean
  hasMore: boolean
  loadMore: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  startNewChat: () => void
}

export function useConversationList(params: {
  engine: SessionEngine | null
  activeId: string | null
  thread: Thread
  isStreaming: boolean
  focusComposer: () => void
}): ConversationListController {
  const { engine, activeId, thread, isStreaming, focusComposer } = params

  const [listRefresh, setListRefresh] = useState(0)
  const sessionList = useSessionList(browserListClient(), listRefresh)
  // 会话重命名乐观覆写：改题即刻反映，服务端回执前先展示新题；失败回滚（删除覆写）。成功后覆写与
  // 服务端清单最终一致（值相同，展示无差），故无需额外对账 effect。
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  const withOverride = (id: string, title: string): string => titleOverrides[id] ?? title

  // 当前活跃会话若尚未在服务端清单出现：合成一条置顶项，不让它从侧栏消失。
  const activeInList = activeId !== null && sessionList.entries.some((entry) => entry.id === activeId)
  const conversations =
    activeId !== null && !activeInList
      ? [
          { id: activeId, title: withOverride(activeId, thread.meta?.title ?? conversationTitle(thread.messages)) },
          ...sessionList.entries.map((entry) => ({ id: entry.id, title: withOverride(entry.id, entry.title) })),
        ]
      : sessionList.entries.map((entry) => ({ id: entry.id, title: withOverride(entry.id, entry.title) }))

  // run 收尾（streaming→idle 落沿）即刷新清单：首条消息落库后新会话进服务端列表，标题也随之更新。
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setListRefresh((n) => n + 1)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const startNewChat = useCallback(() => {
    // 不清 draft：newConversation 换 activeId 后，草稿 controller 会加载新会话自己的草稿。
    engine?.newConversation()
    focusComposer()
  }, [engine, focusComposer])

  const selectConversation = useCallback(
    (id: string) => {
      // 不清 draft：切 activeId 后草稿 controller 加载目标会话草稿（切走的草稿已落盘保留）。
      engine?.openConversation(id)
      focusComposer()
    },
    [engine, focusComposer],
  )

  const deleteConversation = useCallback(
    (id: string) => {
      engine?.deleteConversation(id)
      // 软删后重取清单：服务端软删项即刻不出（本地乐观移除由引擎处理）。
      setListRefresh((n) => n + 1)
    },
    [engine],
  )

  // 会话重命名（CONV-UX）：乐观置题 → PATCH /sessions/{id}/title；成功重取清单对账，失败回滚覆写。
  // 空题/未变化直接忽略（不发请求）。长度上限由端点收口（超 256 → 422 → 回滚）。
  const renameConversation = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (trimmed === "") return
    setTitleOverrides((prev) => ({ ...prev, [id]: trimmed }))
    void browserListClient()
      .renameSession(id, trimmed)
      .then(() => {
        setListRefresh((n) => n + 1)
      })
      .catch(() => {
        setTitleOverrides((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
      })
  }, [])

  return {
    conversations,
    loading: sessionList.loading,
    error: sessionList.error,
    hasMore: sessionList.hasMore,
    loadMore: sessionList.loadMore,
    selectConversation,
    deleteConversation,
    renameConversation,
    startNewChat,
  }
}

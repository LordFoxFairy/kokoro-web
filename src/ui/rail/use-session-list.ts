// 会话清单服务端水合（SESS-LIST）：经 BFF 代理取 session GET /sessions（owner 隔离、
// updated_at desc、软删不出、复合游标分页）。localStorage 不再存清单——换浏览器见同一列表。
// refreshSignal 变化即重取首页（新会话落库/删除后由 shell 触发）。

import { useCallback, useEffect, useState } from "react"

import type { SessionListItem } from "@/contract/http"
import type { SessionClient } from "@/engine/client"

export type SessionListEntry = { id: string; title: string; updatedAt: string }

export type SessionListView = {
  entries: SessionListEntry[]
  loading: boolean
  error: boolean
  hasMore: boolean
  loadMore: () => void
}

function toEntry(item: SessionListItem): SessionListEntry {
  return { id: item.session_id, title: item.title, updatedAt: item.updated_at }
}

type Lister = Pick<SessionClient, "listSessions">

type ListState = {
  entries: SessionListEntry[]
  cursor: string | undefined
  loading: boolean
  loadingMore: boolean
  error: boolean
}

const INITIAL: ListState = { entries: [], cursor: undefined, loading: true, loadingMore: false, error: false }

export function useSessionList(client: Lister, refreshSignal: number): SessionListView {
  const [state, setState] = useState<ListState>(INITIAL)

  // 首页取数（不含同步 setState 供 effect 直接调用，对齐 login-gate idiom）。
  const fetchFirst = useCallback(async (): Promise<ListState> => {
    try {
      const page = await client.listSessions()
      return {
        entries: page.sessions.map(toEntry),
        cursor: page.next_cursor,
        loading: false,
        loadingMore: false,
        error: false,
      }
    } catch {
      return { entries: [], cursor: undefined, loading: false, loadingMore: false, error: true }
    }
  }, [client])

  useEffect(() => {
    let live = true
    void fetchFirst().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [fetchFirst, refreshSignal])

  const loadMore = useCallback(() => {
    setState((prev) => {
      if (prev.cursor === undefined || prev.loadingMore) {
        return prev
      }
      const cursor = prev.cursor
      void client
        .listSessions(cursor)
        .then((page) => {
          setState((cur) => ({
            ...cur,
            entries: [...cur.entries, ...page.sessions.map(toEntry)],
            cursor: page.next_cursor,
            loadingMore: false,
          }))
        })
        .catch(() => {
          setState((cur) => ({ ...cur, loadingMore: false }))
        })
      return { ...prev, loadingMore: true }
    })
  }, [client])

  return {
    entries: state.entries,
    loading: state.loading,
    error: state.error,
    hasMore: state.cursor !== undefined,
    loadMore,
  }
}

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react"

import {
  type AgentMode,
  type ConversationStore,
  activeMode,
  activeThreadOf,
  isActiveModeLocked,
  serializeConversationStore,
  setActiveMode,
  sortedConversations,
} from "@/application/conversation-store"
import {
  createSessionStreamState,
  type SessionStreamState,
} from "@/application/session-stream/reducer"

import { STORAGE_KEY, usePersistentStore } from "./use-persistent-store"

export type ConversationSummary = {
  id: string
  title: string
}

type ConversationStoreApi = {
  // 当前生效的 store：liveStore 一旦出现盖过持久化种子。
  store: ConversationStore | null
  setLiveStore: Dispatch<SetStateAction<ConversationStore | null>>
  persistedStore: ConversationStore | null
  // 活跃会话有在途 live run 时为其 id，否则 null（驱动中断恢复重订阅）。
  pendingConvId: string | null
  thread: SessionStreamState
  conversations: ConversationSummary[]
  activeId: string | null
  mode: AgentMode
  modeLocked: boolean
  // 开聊前落在 pendingMode，开聊时由首个会话承接。
  pendingMode: AgentMode
  setMode: (mode: AgentMode) => void
}

// 会话 store 协作者：持久化种子 + liveStore + 派生视图 + 回应模式，从 useConversation 抽出，
// 让主 hook 只负责组合。所有派生只读，写入统一经 setLiveStore。
export function useConversationStore(): ConversationStoreApi {
  // 持久化种子：水合后才出现，作为会话 store 的初始值。
  const persistedStore = usePersistentStore()
  // 本会话内的所有变更都落在 liveStore；一旦出现就盖过种子。
  const [liveStore, setLiveStore] = useState<ConversationStore | null>(null)
  const store = liveStore ?? persistedStore
  // 空首屏（尚无会话）时选好的模式：首条消息创建首个会话时承接它。会话存在后模式以会话为准。
  const [pendingMode, setPendingMode] = useState<AgentMode>("fast")

  // 活跃会话是否有在途 live run（用于中断恢复）。
  const pendingConvId =
    store?.conversations.find((entry) => entry.id === store.activeId)
      ?.pendingInput
      ? store.activeId
      : null

  // 会话 store 变化即落盘；仅在 liveStore 出现后写入——种子本就来自存储，无需原样回写。
  useEffect(() => {
    if (typeof window === "undefined" || liveStore === null) {
      return
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializeConversationStore(liveStore)),
    )
  }, [liveStore])

  const thread = store ? activeThreadOf(store) : createSessionStreamState()
  const conversations: ConversationSummary[] = store
    ? sortedConversations(store).map((entry) => ({
        id: entry.id,
        title: entry.title,
      }))
    : []
  const activeId = store?.activeId ?? null
  // 模式以活跃会话为准；尚无会话时用 pendingMode。开聊后锁定。
  const mode: AgentMode = store ? activeMode(store) : pendingMode
  const modeLocked = store ? isActiveModeLocked(store) : false

  const setMode = useCallback(
    (next: AgentMode) => {
      // 已开聊即锁定：忽略切换。无会话时落在 pendingMode，有会话时写入活跃会话。
      if (modeLocked) {
        return
      }
      if (store) {
        setLiveStore((prev) => {
          const current = prev ?? persistedStore
          return current ? setActiveMode(current, next) : current
        })
      } else {
        setPendingMode(next)
      }
    },
    [modeLocked, store, persistedStore],
  )

  return {
    store,
    setLiveStore,
    persistedStore,
    pendingConvId,
    thread,
    conversations,
    activeId,
    mode,
    modeLocked,
    pendingMode,
    setMode,
  }
}

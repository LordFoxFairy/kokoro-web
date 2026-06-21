import { useEffect, useRef, useState } from "react"

import type { ConversationSummary } from "../hooks/use-conversation"
import { PanelIcon, PlusIcon, SearchIcon } from "./icons"
import { filterConversations } from "./session-rail-search"

type SessionRailProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewChat: () => void
  conversations: ConversationSummary[]
  activeId: string | null
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
}

export function SessionRail({
  collapsed,
  onToggleCollapse,
  onNewChat,
  conversations,
  activeId,
  onSelectConversation,
  onDeleteConversation,
}: SessionRailProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 打开搜索即聚焦输入框，省去一次额外点击。
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    }
  }, [searchOpen])

  const closeSearch = () => {
    setSearchOpen(false)
    setQuery("")
  }

  const filtered = filterConversations(conversations, query)
  const hasConversations = conversations.length > 0

  return (
    <aside className="kk-rail" aria-label="会话导航">
      <div className="kk-rail__head">
        <div className="kk-rail__brand">
          <div className="kk-rail__brand-mark" aria-hidden>
            心
          </div>
          <div className="kk-rail__brand-text">
            <p className="kk-rail__brand-title">Kokoro</p>
            <p className="kk-rail__brand-subtitle">こころ</p>
          </div>
        </div>

        <div className="kk-rail__head-actions">
          {/* 搜索切换：仅过滤本地「最近」列表，故收起态（列表已隐藏）不显此键。 */}
          <button
            className="kk-rail__head-btn kk-rail__search-toggle"
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-label="搜索会话"
            aria-expanded={searchOpen}
            aria-pressed={searchOpen}
            data-active={searchOpen ? "true" : "false"}
          >
            <SearchIcon />
          </button>
          <button
            className="kk-rail__head-btn"
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
          >
            <PanelIcon />
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="kk-rail__search-box">
          <SearchIcon className="kk-rail__search-glyph" />
          <input
            ref={searchInputRef}
            className="kk-rail__search-input"
            type="search"
            value={query}
            placeholder="搜索最近会话…"
            aria-label="搜索最近会话"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeSearch()
              }
            }}
          />
          <button
            className="kk-rail__search-close"
            type="button"
            aria-label="关闭搜索"
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}

      <button
        className="kk-rail__action kk-rail__new-chat"
        type="button"
        onClick={onNewChat}
      >
        <PlusIcon />
        <span className="kk-rail__action-label">新对话</span>
      </button>

      {hasConversations ? (
        <nav className="kk-rail__list" aria-label="最近会话">
          <p className="kk-rail__section">最近</p>
          {filtered.length > 0 ? (
            filtered.map((conversation) => (
              <div
                key={conversation.id}
                className="kk-rail__item"
                data-active={conversation.id === activeId ? "true" : "false"}
              >
                <button
                  className="kk-rail__item-select"
                  type="button"
                  onClick={() => onSelectConversation(conversation.id)}
                  aria-current={
                    conversation.id === activeId ? "true" : undefined
                  }
                >
                  <span className="kk-rail__item-title">
                    {conversation.title}
                  </span>
                </button>
                <button
                  className="kk-rail__item-delete"
                  type="button"
                  aria-label={`删除会话 ${conversation.title}`}
                  onClick={() => onDeleteConversation(conversation.id)}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <p className="kk-rail__empty">没有匹配的会话</p>
          )}
        </nav>
      ) : null}

      <div className="kk-rail__user-card">
        <div className="kk-rail__user-avatar" aria-hidden />
        <div className="kk-rail__user-text">
          <p className="kk-rail__user-name">当前用户</p>
          <p className="kk-rail__user-meta">本地会话</p>
        </div>
      </div>
    </aside>
  )
}

import { useEffect, useRef, useState } from "react"

import { ChatsIcon, PanelIcon, PlusIcon, SearchIcon, SlidersIcon } from "@/ui/icons/rail"

import { filterConversations, type ConversationSummary } from "./rail-search"
import styles from "./session-rail.module.css"

type SessionRailProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewChat: () => void
  conversations: ConversationSummary[]
  activeId: string | null
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
}

// 空标题（尚无用户消息）的占位文案由渲染层决定：状态层只存空串。
export const UNTITLED_CONVERSATION = "新对话"

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
    <aside className={styles.rail} aria-label="会话导航" data-collapsed={collapsed}>
      <div className={styles.head}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden>
            心
          </div>
          <div className={styles.brandText}>
            <p className={styles.brandTitle}>Kokoro</p>
            <p className={styles.brandSubtitle}>こころ</p>
          </div>
        </div>

        <div className={styles.headActions}>
          {/* 搜索切换：仅过滤本地「最近」列表，故收起态（列表已隐藏）不显此键。 */}
          <button
            className={`${styles.headBtn} ${styles.searchToggle}`}
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-label="搜索会话"
            aria-expanded={searchOpen}
            aria-pressed={searchOpen}
            data-active={searchOpen ? "true" : "false"}
          >
            <SearchIcon className={styles.icon} />
          </button>
          <button
            className={styles.headBtn}
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
          >
            <PanelIcon className={styles.icon} />
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className={styles.searchBox}>
          <SearchIcon className={styles.searchGlyph} />
          <input
            ref={searchInputRef}
            className={styles.searchInput}
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
            className={styles.searchClose}
            type="button"
            aria-label="关闭搜索"
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}

      <nav className={styles.nav} aria-label="主导航">
        {/* 新对话：带 ⇧⌘O 快捷键（SessionShell 已接入键盘）。 */}
        <button
          className={`${styles.navItem} ${styles.navItemAction}`}
          type="button"
          onClick={onNewChat}
        >
          <PlusIcon className={styles.icon} />
          <span className={styles.navLabel}>新对话</span>
          <span className={styles.navShortcut} aria-hidden>
            ⇧⌘O
          </span>
        </button>

        {/* 对话：当前所在视图——非动作，仅作高亮指示（kokoro 即聊天本身）。 */}
        <div className={styles.navItem} data-active="true" aria-current="page">
          <ChatsIcon className={styles.icon} />
          <span className={styles.navLabel}>对话</span>
        </div>
      </nav>

      {hasConversations ? (
        <nav className={styles.list} aria-label="最近会话">
          <div className={styles.sectionRow}>
            <p className={styles.section}>最近</p>
            {/* 未实现能力入口保持 disabled 而非隐藏：不假装可点，也不消失误导。 */}
            <button
              className={styles.sort}
              type="button"
              disabled
              title="会话排序即将支持"
              aria-label="会话排序"
            >
              <SlidersIcon className={styles.sortIcon} />
            </button>
          </div>
          {filtered.length > 0 ? (
            filtered.map((conversation) => {
              const title = conversation.title || UNTITLED_CONVERSATION
              return (
                <div
                  key={conversation.id}
                  className={styles.item}
                  data-active={conversation.id === activeId ? "true" : "false"}
                >
                  <button
                    className={styles.itemSelect}
                    type="button"
                    onClick={() => onSelectConversation(conversation.id)}
                    aria-current={conversation.id === activeId ? "true" : undefined}
                  >
                    <span className={styles.itemTitle}>{title}</span>
                  </button>
                  <button
                    className={styles.itemDelete}
                    type="button"
                    aria-label={`删除会话 ${title}`}
                    onClick={() => onDeleteConversation(conversation.id)}
                  >
                    ×
                  </button>
                </div>
              )
            })
          ) : (
            <p className={styles.empty}>没有匹配的会话</p>
          )}
        </nav>
      ) : null}

      <div className={styles.userCard}>
        <div className={styles.userAvatar} aria-hidden />
        <div className={styles.userText}>
          <p className={styles.userName}>当前用户</p>
          <p className={styles.userMeta}>本地会话</p>
        </div>
      </div>
    </aside>
  )
}

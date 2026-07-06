import { useEffect, useRef, useState } from "react"

import { useLocale, useT } from "@/i18n/context"
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

export function SessionRail({
  collapsed,
  onToggleCollapse,
  onNewChat,
  conversations,
  activeId,
  onSelectConversation,
  onDeleteConversation,
}: SessionRailProps) {
  const t = useT()
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
    <aside className={styles.rail} aria-label={t("rail.railAria")} data-collapsed={collapsed}>
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
            aria-label={t("rail.searchAria")}
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
            aria-label={collapsed ? t("rail.expandAria") : t("rail.collapseAria")}
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
            placeholder={t("rail.searchPlaceholder")}
            aria-label={t("rail.searchInputAria")}
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
            aria-label={t("rail.searchClose")}
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}

      <nav className={styles.nav} aria-label={t("rail.navAria")}>
        {/* 新对话：带 ⇧⌘O 快捷键（SessionShell 已接入键盘）。 */}
        <button
          className={`${styles.navItem} ${styles.navItemAction}`}
          type="button"
          onClick={onNewChat}
        >
          <PlusIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.newChat")}</span>
          <span className={styles.navShortcut} aria-hidden>
            {t("rail.newChatShortcut")}
          </span>
        </button>

        {/* 对话：当前所在视图——非动作，仅作高亮指示（kokoro 即聊天本身）。 */}
        <div className={styles.navItem} data-active="true" aria-current="page">
          <ChatsIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.navChat")}</span>
        </div>
      </nav>

      {hasConversations ? (
        <nav className={styles.list} aria-label={t("rail.recentAria")}>
          <div className={styles.sectionRow}>
            <p className={styles.section}>{t("rail.recent")}</p>
            {/* 未实现能力入口保持 disabled 而非隐藏：不假装可点，也不消失误导。 */}
            <button
              className={styles.sort}
              type="button"
              disabled
              title={t("rail.sortSoon")}
              aria-label={t("rail.sortAria")}
            >
              <SlidersIcon className={styles.sortIcon} />
            </button>
          </div>
          {filtered.length > 0 ? (
            filtered.map((conversation) => {
              const title = conversation.title || t("rail.newChat")
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
                    aria-label={t("rail.deleteChat", { title })}
                    onClick={() => onDeleteConversation(conversation.id)}
                  >
                    ×
                  </button>
                </div>
              )
            })
          ) : (
            <p className={styles.empty}>{t("rail.emptyResult")}</p>
          )}
        </nav>
      ) : null}

      <div className={styles.userCard}>
        <div className={styles.userAvatar} aria-hidden />
        <div className={styles.userText}>
          <p className={styles.userName}>{t("rail.userName")}</p>
          <p className={styles.userMeta}>{t("rail.userScope")}</p>
        </div>
        <LangSwitch />
      </div>
    </aside>
  )
}

// 语言切换器（M3-P4）：zh/en 即时切换 + localStorage 持久化（useLocale 内处理）。
function LangSwitch() {
  const { locale, setLocale, t } = useLocale()
  return (
    <div className={styles.langSwitch} role="group" aria-label={t("lang.switchAria")}>
      <button
        type="button"
        className={styles.langBtn}
        data-active={locale === "zh"}
        aria-pressed={locale === "zh"}
        onClick={() => setLocale("zh")}
      >
        {t("lang.zh")}
      </button>
      <button
        type="button"
        className={styles.langBtn}
        data-active={locale === "en"}
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        {t("lang.en")}
      </button>
    </div>
  )
}

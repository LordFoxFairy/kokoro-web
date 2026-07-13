import { useEffect, useRef, useState } from "react"

import { useLocale, useT } from "@/i18n/context"
import { ChatsIcon, CoinIcon, LibraryIcon, PanelIcon, PlugIcon, PlusIcon, SearchIcon, SlidersIcon, UsersIcon } from "@/ui/icons/rail"
import { useTheme, type ThemeMode } from "@/ui/theme/theme-context"

import { filterConversations, type ConversationSummary } from "./rail-search"
import styles from "./session-rail.module.css"

type SessionRailProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewChat: () => void
  // 服务端按 host 解析的站点品牌名（SITE-REAL）；缺省回退硬编码 Kokoro。
  brandName?: string
  conversations: ConversationSummary[]
  activeId: string | null
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  // 会话重命名（CONV-UX）：提交非空新题；乐观更新 + 失败回滚由上层处理。
  onRenameConversation: (id: string, title: string) => void
  onOpenSkills: () => void
  onOpenMcp: () => void
  onOpenBilling: () => void
  onOpenTeams: () => void
  onOpenLibrary: () => void
  // 清单服务端水合态（SESS-LIST）：加载/错误态与滚动翻页入口。
  listLoading: boolean
  listError: boolean
  hasMore: boolean
  onLoadMore: () => void
}

export function SessionRail({
  collapsed,
  onToggleCollapse,
  onNewChat,
  brandName,
  conversations,
  activeId,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenSkills,
  onOpenMcp,
  onOpenBilling,
  onOpenTeams,
  onOpenLibrary,
  listLoading,
  listError,
  hasMore,
  onLoadMore,
}: SessionRailProps) {
  const t = useT()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 会话重命名内联编辑态（CONV-UX）：editingId 命中的条目以输入框替换标题。
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 打开搜索即聚焦输入框，省去一次额外点击。
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    }
  }, [searchOpen])

  // 进入编辑即聚焦并全选，改题一气呵成。
  useEffect(() => {
    if (editingId !== null) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [editingId])

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setDraftTitle(current)
  }
  const cancelRename = () => {
    setEditingId(null)
    setDraftTitle("")
  }
  // 提交：非空且与原题不同才上抛（空题/未改动直接收工，不触发请求）。
  const commitRename = (current: string) => {
    const value = draftTitle.trim()
    if (editingId !== null && value !== "" && value !== current) {
      onRenameConversation(editingId, value)
    }
    cancelRename()
  }

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
            <p className={styles.brandTitle}>{brandName ?? "Kokoro"}</p>
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

        {/* 作品库入口（ARTIFACT-LIB）：打开属主 namespace 全部成果跨会话聚合的卡片网格模态。 */}
        <button className={styles.navItem} type="button" onClick={onOpenLibrary} data-testid="rail-library">
          <LibraryIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.navLibrary")}</span>
        </button>

        {/* 技能面板入口（WEB-SKILLS）：打开 hub self 面池/上传的模态。 */}
        <button className={styles.navItem} type="button" onClick={onOpenSkills}>
          <SlidersIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.navSkills")}</span>
        </button>

        {/* 连接面板入口（MCP-UX）：MCP server 注册/启停/软删 + 凭据 handle 管理的模态。 */}
        <button className={styles.navItem} type="button" onClick={onOpenMcp} data-testid="rail-mcp">
          <PlugIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.navMcp")}</span>
        </button>

        {/* 余额面板入口（WEB-BILLING）：打开余额卡 + 账单流水的模态。 */}
        <button className={styles.navItem} type="button" onClick={onOpenBilling}>
          <CoinIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.navBilling")}</span>
        </button>

        {/* 团队面板入口（TEAM-1）：切换团队 + 待处理邀请 + 成员管理的模态。 */}
        <button className={styles.navItem} type="button" onClick={onOpenTeams} data-testid="rail-teams">
          <UsersIcon className={styles.icon} />
          <span className={styles.navLabel}>{t("rail.navTeams")}</span>
        </button>
      </nav>

      {hasConversations || listLoading || listError ? (
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
          {listError && !hasConversations ? (
            <p className={styles.empty}>{t("rail.listError")}</p>
          ) : listLoading && !hasConversations ? (
            <p className={styles.empty}>{t("rail.listLoading")}</p>
          ) : filtered.length > 0 ? (
            <>
              {filtered.map((conversation) => {
                const title = conversation.title || t("rail.newChat")
                const editing = conversation.id === editingId
                return (
                  <div
                    key={conversation.id}
                    className={styles.item}
                    data-active={conversation.id === activeId ? "true" : "false"}
                    data-editing={editing ? "true" : "false"}
                  >
                    {editing ? (
                      <input
                        ref={renameInputRef}
                        className={styles.itemRenameInput}
                        value={draftTitle}
                        maxLength={256}
                        aria-label={t("rail.renamePlaceholder")}
                        placeholder={t("rail.renamePlaceholder")}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onBlur={() => commitRename(conversation.title)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            commitRename(conversation.title)
                          } else if (event.key === "Escape") {
                            event.preventDefault()
                            cancelRename()
                          }
                        }}
                      />
                    ) : (
                      <>
                        {/* 双击标题即进入内联改题（与悬停 ✎ 按钮同入口）。 */}
                        <button
                          className={styles.itemSelect}
                          type="button"
                          onClick={() => onSelectConversation(conversation.id)}
                          onDoubleClick={() => startRename(conversation.id, conversation.title)}
                          aria-current={conversation.id === activeId ? "true" : undefined}
                        >
                          <span className={styles.itemTitle}>{title}</span>
                        </button>
                        <button
                          className={styles.itemRename}
                          type="button"
                          aria-label={t("rail.renameChat", { title })}
                          onClick={() => startRename(conversation.id, conversation.title)}
                        >
                          ✎
                        </button>
                        <button
                          className={styles.itemDelete}
                          type="button"
                          aria-label={t("rail.deleteChat", { title })}
                          onClick={() => onDeleteConversation(conversation.id)}
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
              {/* 滚动到底翻页（SESS-LIST 复合游标）：搜索过滤时不出翻页（仅过滤已载入项）。 */}
              {hasMore && query === "" ? (
                <button className={styles.loadMore} type="button" onClick={onLoadMore}>
                  {t("rail.loadMore")}
                </button>
              ) : null}
            </>
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
      </div>
      <div className={styles.railControls}>
        <ThemeSwitch />
        <LangSwitch />
      </div>
    </aside>
  )
}

// 主题切换器（WEB-THEME）：系统/亮/暗三态即时切换 + localStorage 持久化（useTheme 内处理）。
function ThemeSwitch() {
  const t = useT()
  const { mode, setMode } = useTheme()
  const options: { value: ThemeMode; label: string }[] = [
    { value: "system", label: t("theme.system") },
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
  ]
  return (
    <div className={styles.langSwitch} role="group" aria-label={t("theme.switchAria")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.langBtn}
          data-active={mode === option.value}
          aria-pressed={mode === option.value}
          onClick={() => setMode(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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

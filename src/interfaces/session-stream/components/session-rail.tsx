import type { ConversationSummary } from "../hooks/use-conversation"
import { PanelIcon, PlusIcon, SearchIcon } from "./icons"

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

        <button
          className="kk-rail__collapse"
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-expanded={!collapsed}
        >
          <PanelIcon />
        </button>
      </div>

      <button
        className="kk-rail__action kk-rail__new-chat"
        type="button"
        onClick={onNewChat}
      >
        <PlusIcon />
        <span className="kk-rail__action-label">新对话</span>
      </button>

      {/* 会话搜索尚未接入：停用入口并以 title 标注，避免 ⌘K 暗示一个不存在的功能。 */}
      <button
        className="kk-rail__action kk-rail__search"
        type="button"
        title="会话搜索即将支持"
        disabled
      >
        <span className="kk-rail__search-label">
          <SearchIcon />
          <span className="kk-rail__action-label">搜索</span>
        </span>
        <span className="kk-rail__search-shortcut">⌘K</span>
      </button>

      {conversations.length > 0 ? (
        <nav className="kk-rail__list" aria-label="历史会话">
          {conversations.map((conversation) => (
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
          ))}
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

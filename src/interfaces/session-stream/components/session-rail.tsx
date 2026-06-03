import { PanelIcon, PlusIcon, SearchIcon } from "./icons"

type SessionRailProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewChat: () => void
}

export function SessionRail({
  collapsed,
  onToggleCollapse,
  onNewChat,
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

      <button className="kk-rail__action kk-rail__search" type="button">
        <span className="kk-rail__search-label">
          <SearchIcon />
          <span className="kk-rail__action-label">搜索</span>
        </span>
        <span className="kk-rail__search-shortcut">⌘K</span>
      </button>

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

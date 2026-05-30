const CREATION = ["图片", "视频", "数字人", "音频", "设计", "文档", "站点"]
const DISCOVER = ["案例", "Skill Hub", "MCP Hub"]

// 侧栏 IA 外壳（视觉占位，不接路由）。对标 variant-a-mi-mu 单列分组。
export function Sidebar() {
  return (
    <aside className="kk-sidebar">
      <div className="kk-sidebar__brand">
        <span className="kk-sidebar__mark">心</span>
        <span className="kk-sidebar__name">Kokoro</span>
      </div>
      <nav className="kk-sidebar__nav">
        <button className="kk-nav-item kk-nav-item--primary" type="button">新对话</button>
        <button className="kk-nav-item" type="button">搜索</button>
      </nav>
      <p className="kk-sidebar__group-label">创作</p>
      <nav className="kk-sidebar__nav">
        {CREATION.map((label) => (
          <button key={label} className="kk-nav-item" type="button">{label}</button>
        ))}
      </nav>
      <p className="kk-sidebar__group-label">发现</p>
      <nav className="kk-sidebar__nav">
        {DISCOVER.map((label) => (
          <button key={label} className="kk-nav-item" type="button">{label}</button>
        ))}
      </nav>
      <div className="kk-sidebar__user">小 · 免费</div>
    </aside>
  )
}

---
architectureIndex: 1
rootId: web.user.ui.rail
owners:
  - "@LordFoxFairy"
---

# ui/rail — 侧栏

## 职责
会话清单（服务端水合、分页、待批徽标、重命名/删除、搜索）+ 品牌头 + 各面板入口 + 折叠/移动抽屉 + 拖拽改宽。

## 公开件
- `SessionRail`（`session-rail.tsx`）：侧栏组件；清单/回调/入口全由 props 注入。
- `useSessionList`：服务端清单水合 + 复合游标翻页累加。
- `useRailResize`：拖拽改宽（含 shell 容器几何 ref）。
- `rail-search.ts`：清单本地过滤。

## 协作者
上游：`@/ui/shell`（`useConversationList` controller 供数据/回调）。取数经 `@/ui/shell/page-clients` 的 list client。

## 陷阱
- 清单真源是 session `GET /sessions`（换浏览器见同列表）；localStorage 不再作清单真源。
- `useSessionList` 是分页 accumulator 惯用法，不走 `@/lib/query`（无限滚动累加自持游标）。

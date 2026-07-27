---
architectureIndex: 1
rootId: web.user.ui.todo
owners:
  - "@LordFoxFairy"
---

# ui/todo — 计划条

## 职责
把当前会话的待办清单钉在输入框正上方，常驻可查、不随对话滚走：标题 + 完成计数 + 进度条 + 可收缩条目列表（完成 / 进行中 / 待办三态图标）。纯展示，不发任何命令。

## 公开件
- `TodoBar`（`todo-bar.tsx`）：props `todos: SessionTodo[]`。`todos` 为空时返回 `null`（不在输入框上方留空壳）。收缩态为组件内部 state，落在 `data-collapsed` 上；进度条带 `role="progressbar"` + `aria-valuemin/max/now`。
- `todo-bar.module.css`：`.todobar`/`.toggle`/`.progress`/`.todo[data-status]` 皮肤。

## 协作者
上游：`@/ui/shell/session-shell`（`thread.todos`，仅在 `mounted` 后渲染以避开水合不一致）。
下游：`@/core/state` 的 `SessionTodo`（= 契约事件 `todo.updated` payload 里的条目类型）、`@/i18n`（`todo.plan`）、`@/ui/icons/thread` 的 `CheckCircleIcon`/`ChecklistIcon`/`ChevronIcon`/`CircleIcon`/`DotCircleIcon`。

## 扩展规则
待办数据由 `todo.updated` 事件折叠进 `@/core/state` 的会话态，本组件只读渲染。要让用户勾选/编辑待办，先扩 session 控制契约再从 shell 注入回调，不要在此直接调 `SessionClient`。新状态值先加进契约 `status` 联合，再在 `todoIcon` 补分支。

## 陷阱
- `SessionTodo["status"]` 直接派生自契约；`todoIcon` 的兜底分支渲染「待办」图标，新增状态若不补分支会静默显示成待办。
- 列表 key 用 `${index}-${todo.content}`：后端整批替换 todos，无稳定 id；不要改成纯 `index` 或纯 `content`。
- 组件无 `"use client"` 指令，靠调用方（`session-shell` 是客户端组件）提供客户端上下文；单独在 server component 里渲染会因 `useState`/`useT` 报错。

---
architectureIndex: 1
rootId: web.user.ui.share
owners:
  - "@LordFoxFairy"
---

# ui/share — 会话分享控件

## 职责
会话头部的分享入口（SHARE-1）：为当前会话创建**可撤销的只读分享** → 展示/复制公共链接 → 撤销。只负责创作者一侧的控制面；公共只读页由 `@/app/shared/[id]` + `@/ui/shared/shared-thread` 承载。

## 公开件
- `ShareButton`（`share-button.tsx`，`"use client"`）：props `client: Pick<SessionClient, "createShare" | "revokeShare">` / `sessionId`。内部四态机 `idle | creating | shared | error`，`shared` 态弹出 `role="dialog"` 小浮层（链接只读输入框 + 复制 / 撤销 / 完成）。测试锚点 `data-testid="share-control"` / `"share-button"`。
- `share-button.module.css`：`.trigger`/`.popover`/`.linkRow` 等皮肤。

## 协作者
上游：`@/ui/shell/session-shell`（会话头部，`client={browserListClient()}`、`sessionId={activeId}`）。
下游：`@/engine/client` 的 `createShare`/`revokeShare`、`@/i18n`（`share.*` 文案）、`navigator.clipboard`。公共链接指向同源 `/shared/{share_id}`，由 `@/ui/shared` 渲染。

## 扩展规则
分享策略（有效期、密码、可见范围）属 session 契约，先扩 `SessionClient` 再在此消费；不要在本组件拼分享 URL 之外的后端路径。链接形状固定为同源 `${origin}/shared/{share_id}`——换形状要同时改 `@/app/shared/[id]` 路由。

## 陷阱
- 创建幂等：同一会话已有活跃分享时后端返回同一 `share_id`，前端不做去重，重复点击不会产生第二条分享。
- 撤销后公共链接立即 404；撤销失败**保持 `shared` 态**（不回 `idle`），避免误导用户以为已撤销。
- 复制失败（非 https / 无剪贴板权限）被静默吞掉：链接仍可见可手动选中，不阻断也不报错。
- 组件不自持匿名闸，只在已登录的 `SessionShell` 内渲染；会话有效性由上游保证。

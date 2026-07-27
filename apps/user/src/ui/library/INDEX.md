---
architectureIndex: 1
rootId: web.user.ui.library
owners:
  - "@LordFoxFairy"
---

# ui/library — 作品库（跨会话成果聚合）

## 职责
把属主 namespace 下**跨会话**的全部成果（artifact）聚合成卡片网格：图标 / 标题 / 大小 / 时间 / 来源会话跳转 / 点击下载，带游标翻页与空态。成果不可变、内容寻址，本面只读——与可变工作区文件面（`@/ui/canvas`）分离。

## 公开件
- `LibraryContent`（`artifact-library-panel.tsx`，`"use client"`）：**内容体**，props `client: Pick<SessionClient, "listArtifacts">` / `onOpenSession(sessionId)`（跳源会话；关闭责任在调用方）。被设置中心「作品」tab 直接嵌入。
- `ArtifactLibraryPanel`（同文件）：内容体 + 自带背幕/标题栏/关闭按钮的独立模态壳，props 多一个 `onClose`。
- `artifact-library-panel.module.css`：`.overlay`/`.panel`/`.grid`/`.card` 皮肤（守 `--k-*` token）。

## 协作者
上游：`@/ui/settings/settings-modal`（嵌 `LibraryContent`，`onOpenSession` 走共享引擎 `openConversation` + 关模态）。
下游：`@/engine/client.listArtifacts`（分页）、`@/engine/config.sessionBaseUrl`、`@/engine/file-fetch`（鉴权下载）、`@/contract/http`（`ArtifactRecord` / `artifactContentPath`）、`@/i18n`（`library.*` 文案）、`@/ui/thread/artifact-card.formatBytes`、`@/ui/canvas/canvas-panel.formatDeliveryTime`、`@/ui/icons/thread.DeliveryIcon`。

## 扩展规则
新增成果视图（筛选、预览、批量）加在 `LibraryContent` 内，保持 `ArtifactLibraryPanel` 只是它的浮层壳；分页状态留在本组件，不上抬到 shell。跨会话列表数据一律经 `SessionClient`，不在本目录直接拼 session URL 之外的端点。

## 陷阱
- 下载必须走 `fileFetch` → `blob` → 临时 `<a download>`：内容端点已鉴权，`<a href>` 直连拿 401。
- `listArtifacts` 用复合游标；`loadMore` 只在 `cursor !== undefined && !loadingMore` 时触发，追加而非替换；失败只回滚 `loadingMore`，已加载页不清空。
- `client` 收窄成 `Pick<SessionClient, "listArtifacts">`，测试注入假件即可，不要改成全量 `SessionClient`。
- `ArtifactLibraryPanel` 目前只有测试（`tests/ui/artifact-library-panel.test.tsx`）在用，src 侧唯一入口是设置中心嵌的 `LibraryContent`；改动前确认是否还需要保留独立模态入口。

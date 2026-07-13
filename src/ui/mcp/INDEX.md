# ui/mcp — 连接面板

## 职责
hub self 面 MCP server 池（注册/启停/软删）+ 凭据 handle 管理（创建/列表/删除，值只进不出）。

## 公开件
- `McpPanel`（`mcp-panel.tsx`）：props `client: HubClient` / `onClose`。

## 协作者
- `@/hub/client`（纯请求）、`@/hub/schemas`（`MCP_TRANSPORTS` 等）。
- `@/lib/query`：server+secret 合并读走 `useResource("hub/mcp")`；任一变更后 `invalidate("hub/mcp")`。

## 陷阱
- secrets 尽力而为：secret broker 未配置（503）容错回空池，不拖垮整个面板。
- official server 只读（徽标标注）；namespace 自有项可启停/软删。
- 凭据 value 只进不出：secret_ref 恒为 `handle:srt_...` 引用或 null。
- hub 拒绝（mutation 门 / 私网 URL / 非法凭据引用）经错误码人话化（`humanizeError`）。

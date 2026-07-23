# lib/query — 共享 server-state 层

## 职责
统一服务态契约：读缓存/去重/失活 + 写提交态/错误归一。吸收「统一服务态契约」思想，规模不引 react-query。

## 公开件（`index.ts`）
- `useResource(key, fetcher)` → `{ data, error, loading, refetch }`：模块级缓存 + in-flight 去重 + 挂载后台刷新（SWR，缓存不闪空）。
- `useAsyncAction(action)` → `{ run, submitting, error, reset }`：`run(...args)` 不抛，回 `{ok:true} | {ok:false,error}` 供 UI 分支；提交中忽略重复触发。
- `invalidate(keyPrefix)`：前缀失活——有订阅者立即重取，无订阅者丢缓存下次挂载再取。
- 内部：`resource-store.ts`（模块缓存 + pub/sub + 竞态序号；`__resetResourceStore` 为 test-only）。

## 协作者
下游：各域面板（skills/mcp/team/billing）+ shell controller。键约定：`<域>/<资源>`（如 `hub/skills`、`team/detail/<ns>`、`billing/summary`）。

## 陷阱
- 竞态先发后至丢弃：全局自增序号，仅最新一发结果落地。
- 分页无限滚动列表不走本层（自持游标 accumulator，见 use-session-list / billing ledger / artifact library）。
- 测试隔离：`tests/setup.ts` 每例后 `__resetResourceStore()`，避免跨例缓存污染。

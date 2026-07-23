# engine — 会话引擎（状态机 + 浏览器 I/O 唯一编排者）

## 职责

显式会话状态机与 framework-free 引擎：snapshot-first 水合、SSE 流句柄、HITL 决策暂存、
重连/超时收口、多 tab 同步。React 只经 `use-session-engine` 一个接缝订阅快照。

## 公开 API

- `machine.ts`
  - `transition(state, event)`：纯状态机（idle/submitting/streaming/reattaching/
    awaiting-hitl/error）；非法迁移返回入参 state（引用相等=被守卫拒绝，双发守卫据此实现）；
    runId 锚定——只有本轮 run 的事件能推动相位。
  - `createSessionEngine(deps) → SessionEngine`：submit（运行中插话转 steer POST，不动
    状态机）/ retry（未回执重试复用 idempotency_key）/ cancelRun / stageToolDecision /
    selectConversation / newConversation / deleteConversation / setMode / dispose。
  - `EngineSnapshot`、`SERVER_ENGINE_SNAPSHOT`（SSR 首帧一致性）、`NoticeSpec`
    （瞬态通知发 i18n key 不落文案）。
- `client.ts`：`createSessionClient({baseUrl}) → SessionClient`——全部入站过
  contract zod，失败以 `SessionClientError`（network/http/parse）上抛零静默降级；
  baseUrl+path 直接拼接（非 new URL，保住 `/api/session` 前缀）；AUTH-P0 起客户端不持
  token，鉴权由同源 BFF 代理注入 Bearer、httpOnly 信封 cookie 同源自动携带；
  `openEvents` 用 fetch 流式 SSE（非 EventSource，首连即可带 Last-Event-ID=seq），断流按
  最后 seq 定时重连；`fetchSnapshot` 404/410 返 null（空线程即真态）；`createSseFrameParser`。
- `hitl-staging.ts`：`stageDecision`/`buildResumeDecisions`（按契约 pending_tool_ids
  凑齐同帧才产出，未凑齐 null）/`rejectedToolIds`/`pendingToolIdsOf`；`ToolDecision`。
- `reattach.ts`：`reattachPlanFromSnapshot`（在途 run 权威判据；有 pending 暂停直接落
  awaiting-hitl 不设时限）、`REATTACH_TIMEOUT_MS`（90s 兜底）。
- `config.ts`：`sessionBaseUrl()`——同源 BFF 代理前缀 `/api/session`（AUTH-P0）；浏览器不再
  直连 kokoro-session，真实地址留服务端代理，`SESSION_PROXY_BASE` 常量。
- `file-fetch.ts`（client 组件）：`fileFetch`/`useFileBlob`——files/deliveries 走同源
  `/api/session` 代理，鉴权由 httpOnly 信封 cookie 自动携带（前端不持 token）；仍 fetch→blob
  →object URL 供预览/下载（结果被替换/卸载即 revoke；loading 为键控派生，无 effect 同步 setState）。
- `use-session-engine.ts`（client 组件）：`useSessionEngine(engine|null)`——全仓唯一
  React 接缝（useSyncExternalStore）。

## 关键协作者

- 下游依赖：`core/*`（reducer/state/hydration/conversations）、`contract/*`（zod 真源）、
  `lib/persisted-store`（跨 tab storage 事件）。
- 上游：页面装配层持有 engine 实例（页面级、仅浏览器创建）。

## 运行时约束

- 三重代际守卫（stream/hydrate/filesSync）：关流/切会话后迟到回调一律丢弃。
- run 收尾对账吸收 snapshot.files 与 snapshot.deliveries（成果整表替换，contentHash 同形）。
- 事件微任务窗口批量折叠一次（replay 洪峰不逐事件快照）。
- resume 的 decision_id 与提交 idempotency_key 复用语义是幂等前提，重试不得换新 id。
- control 撞 STALE 冲突码（run_not_active/no_pending_pause/session_deleted）→ 清暂存 +
  snapshot 对账重水合，绝不把用户卡死在 awaiting-hitl。
- awaiting-hitl 与已见 live 事件的 streaming 撤 90s 兜底；仅 reattaching 持 TIMEOUT 计时。

## 扩展规则

- 新用户动作 = 引擎新方法 + 状态机新事件（先在 transition 补迁移，规格测试主战场）。
- 浏览器 I/O 一律进 engine/client，不得散落进组件；组件只消费 EngineSnapshot。

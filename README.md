# kokoro-web

Kokoro 三仓里的**界面层**：Next.js 聊天壳。通过 SSE 从 kokoro-session 消费 AGUI 信封，严格解析 →
reducer 折叠成有序 thread → 渲染对话 + agent 活动流（计划条 / 工具行 / 子代理 / 思考过程块）。
**纯消费**——用户输入是本地发起的 run，不产生事件。

> 全局架构与起栈见 [根 README](../README.md)。

## 分层（四层 DDD）

```
src/
├── domain/          session-stream-event.ts（render 联合类型，camelCase）
├── application/     conversation-store / session-stream/（reducer / reply 编排 / transport / simulator）
├── infrastructure/  transport-event-schema.ts（入站 zod）/ transport-event-mapper.ts（→ render）
└── interfaces/      session-stream/（session-shell + components/ + hooks/）
```

`domain/session-stream-event.ts` 与 `infrastructure/transport-event-schema.ts` 由
[`contract/generate.py`](../contract/events.yaml) **生成**（`DO NOT EDIT`）；改契约改根 `contract/events.yaml`。

## 运行

```bash
bun install
bun run dev      # :3000
```

后端地址用 `NEXT_PUBLIC_KOKORO_SESSION_BASE_URL`（默认 `http://127.0.0.1:3001`）。
后端不可达时自动**降级到本地预览**（确定性 simulator），离线也能试 UI。

## 门禁

```bash
bun run test         # vitest（schema/reducer/组件边界矩阵 + session-shell 整壳集成）
bun run typecheck
bun run lint
bun run build
```

## 关键不变量

- **seq 唯一排序源**：渲染顺序只由信封 `seq` 决定（per-run 非递减），不靠到达顺序。
- **多段交错**：`tool → text → tool` 不塌缩，工具挂在它产出的答案段下；首 token 不跳盒。
- **中断恢复**：刷新 reattach 全量重放 + 去重；瞬断 `Last-Event-ID` 增量续传；重连有可辨提示。
- **严格解析隔离**：单条畸形/未知事件 skip-and-continue，不污染 thread、不整体崩。
- **持久化降级**：localStorage 脏数据丢坏保好，不崩。

测试用例总账见 [测试总目录](../docs/superpowers/specs/2026-06-13-test-case-catalog.md) §3；流式 UI 设计见
[多段流](../docs/superpowers/specs/2026-06-06-multi-segment-assistant-stream-design.md) /
[连续性](../docs/superpowers/specs/2026-06-13-stream-continuity-design.md)。

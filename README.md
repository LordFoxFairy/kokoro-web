# kokoro-web

Kokoro 三仓里的**界面层**：Next.js 聊天壳。通过 SSE 从 kokoro-session
消费 AGUI 信封，严格解析，按 session 发送顺序 append 到 thread，
再渲染对话和 agent 活动流。
**纯消费**——用户输入是本地发起的 run，不产生事件。

> 全局架构与起栈见 [根 README](../README.md)。

## 分层（四层 DDD）

```text
src/
├── domain/          session-stream-event.ts（render 联合类型，camelCase）
├── application/     conversation-store / session-stream
├── infrastructure/  transport-event-schema / transport-event-mapper
└── interfaces/      session-stream/（session-shell + components/ + hooks/）
```

`domain/session-stream-event.ts` 与 `infrastructure/transport-event-schema.ts` 由
[`contract/generate.py`](../contract/events.yaml) 生成；改契约改根
`contract/events.yaml`。

## 运行

```bash
npm install
npm run dev      # :3000
```

后端地址用 `NEXT_PUBLIC_KOKORO_SESSION_BASE_URL`（默认 `http://127.0.0.1:3001`）。
后端不可达时自动**降级到本地预览**（确定性 simulator），离线也能试 UI。

## 门禁

```bash
npm test              # vitest（schema/reducer/组件边界矩阵 + session-shell 整壳集成）
npm run typecheck
npm run lint
npm run build
```

## 关键不变量

- **按流到达顺序渲染**：session 负责 DB replay + live tail 的顺序收敛；
  web 只做 `eventId` 去重并按接收顺序 append。
- **多段交错**：`tool → text → tool` 不塌缩，工具挂在答案段下。
- **中断恢复**：刷新 reattach 全量重放 + 去重；瞬断走 `Last-Event-ID`。
- **严格解析隔离**：单条畸形/未知事件 skip-and-continue，不污染 thread、不整体崩。
- **持久化降级**：localStorage 脏数据丢坏保好，不崩。

测试用例总账见根仓测试总目录 §3；流式 UI 设计见根仓
`docs/superpowers/specs` 下的多段流和连续性设计。

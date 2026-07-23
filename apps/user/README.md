# kokoro-web

Kokoro 的 web 子仓：Next.js 聊天与工作区界面。它通过 HTTP/SSE 连接
`kokoro-session`，把 session 快照和事件严格解析后折叠成 thread、activity、todo、workspace
files 与右侧 canvas 预览。

> 全局架构与起栈见 [根 README](../README.md)。

## 当前边界

`kokoro-web` 不拥有 agent 执行、session 存储、workspace 归档、用户主数据或能力 registry。它只拥有：

- 浏览器端会话壳、输入、侧栏、活动流、HITL 卡片、todo、canvas 预览。
- session HTTP/SSE client，以及入站契约校验失败后的 UI 状态收口。
- 本地草稿、会话列表投影和开发预览 transport。
- 登录/注册 UI 和极薄 auth facade 的 web 接入面；用户真源仍来自平台侧用户服务。

对 GA / agent 的身份隔离，web 只传递上游 token，不在前端拼接业务化 namespace。GA 侧只有
`namespace` 这一条隔离轴；`ownerId` / `userId` 只属于 web/session/platform 的权限语义。

## 源码结构

```text
src/
  app/        Next app entry
  contract/   generated/shared runtime schemas consumed by the web client
  core/       pure reducer, projections, persistence and conversation state
  engine/     session client, state machine, reattach and HITL staging
  dev/        explicit local preview transport
  i18n/       UI message catalog and resolver
  lib/        browser storage and hydration utilities
  ui/         shell, rail, composer, thread, canvas, HITL and todo UI
tests/
  app/ core/ engine/ i18n/ ui/
```

This repo is on Next.js 16.2.6. Before changing framework-facing code, read the relevant guide in
`node_modules/next/dist/docs/`; this is required by `AGENTS.md`.

## 运行

```bash
npm install
npm run dev
```

Runtime env:

```text
NEXT_PUBLIC_SESSION_BASE_URL=http://127.0.0.1:3001
```

`NEXT_PUBLIC_SESSION_BASE_URL` 缺失会 fail-loud。开发预览 transport 只能通过显式 env 开关启用，
不会自动嗅探端口或静默降级。

## 门禁

```bash
npm test              # vitest（schema/reducer/组件边界矩阵 + session-shell 整壳集成）
npm run typecheck
npm run lint
npm run build
```

## 文档位置

web 子仓自己的长期文档放在 [docs/](./docs/README.md)。跨仓总体方案、handbook、ADR 和产品决策放根仓
`../docs/`，不要复制进 web 子仓。

## 关键不变量

- **稳定交错序**：`seq` 只用于同一 run 内 thinking/tool/subagent/text 的 UI 交错；去重靠 `eventId`，续传靠 SSE `Last-Event-ID`。
- **多段交错**：`tool → text → tool` 不塌缩，工具挂在它产出的答案段下；首 token 不跳盒。
- **中断恢复**：刷新 reattach 全量重放 + 去重；瞬断 `Last-Event-ID` 增量续传；重连有可辨提示。
- **严格解析隔离**：单条畸形/未知事件 skip-and-continue，不污染 thread、不整体崩。
- **持久化降级**：localStorage 脏数据丢坏保好，不崩。

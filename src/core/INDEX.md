# core — 纯状态模型与事件折叠（零 I/O 零 React）

## 职责

web 的领域核心：会话线程状态、事件折叠 reducer、渲染投影、snapshot 水合、
多会话列表索引与其落盘 schema。全部纯函数，词汇直接取自 contract（z.infer 即领域类型）。

## 公开 API

- `state.ts`：`SessionStreamState`（messages/todos/stepsByRun/runStatus/runError/
  activeRunId/lastSeq/files/deliveries/meta + seenEventIds 内存去重集）、`createSessionStreamState`、
  `SessionStep`（thinking/tool/subagent/text 按 seq 有序，非按 kind 归桶）、
  `SessionToolCall`/`ToolStatus`（含结构化终态 stale-*/cancelled，零 UI 文案）、
  `SessionMessage`/`SessionSubagent`/`SessionDelivery`（成果=冻结结论，contentHash 内容寻址）
  及契约派生类型别名。
- `reducer.ts`
  - `applySessionEvents(state, events)`：批量折叠——event_id 幂等去重、整批一次顶层快照、
    可变草稿逐事件折叠（修 replay O(n²)）；全部重复时原样返回入参（引用相等表达幂等）。
  - `applySessionEvent`：单事件包装。
  - 本地命令（非事件折叠）：`appendUserMessage`（本地 echo，usr_ 前缀 id）、
    `markToolRejected`（拒绝乐观置位，防回流翻绿勾）、`markRunCancelled`（停止本地收口）。
- `projections.ts`：`buildThreadItems`（连续同 runId assistant 归并为 turn；纯派生，
  渲染层唯一读取模型）、`groupSegments`/`Segment`（turn 内按 segmentId 聚合过程）。
- `hydration.ts`：`stateFromSnapshot`——只取 meta/files/deliveries/activeRunId；线程内容由
  事件史全量回放重建（唯一完整真源），水合 lastSeq=0。`deliveryFromSnapshot`——
  snapshot delivery 的 snake→camel 投影（engine run 收尾对账复用）。
- `conversations.ts`：`ConversationStore` 列表索引纯操作（add/touch/select/remove/
  setActiveMode/sortedConversations/conversationTitle）；`AgentMode`（纯 UI 偏好，不上 wire）。
- `persistence.ts`：`parseStoredConversationStore`——落盘 zod schema，只存 UI 偏好与
  列表索引（消息/run/暂停点真源在服务端）；旧形状判脏重建。

## 关键协作者

- 上游消费：`engine/machine.ts`（唯一编排者）、渲染组件（经 projections 读取）。
- 下游依赖：仅 `@/contract/*` 类型；无 React、无 fetch、无 storage。

## 运行时约束

- 折叠幂等靠 event_id（Set 本页生命周期内）；lastSeq 只作续流水位，非业务排序 cursor。
- 终态 runStatus/runError 是单槽投影：仅在无在途锚点或终态属在途 run 时写——
  reattach 全量回放里历史 run 的终态不得覆写在途 run。
- `insertOrdered` 按 (seq, 到达先后) 稳定插入；乱序/部分 replay 时 awaiting/returned
  可先于 invoked 到达，各 apply 函数补建步骤不丢事件。

## 扩展规则

- 新 SessionEvent kind：reducer 的 switch 有 never 穷尽守卫，必须显式接收（哪怕不投影）。
- 新派生视图放 projections.ts，不在组件里手写归组。
- 本目录禁止引入 I/O、React、副作用；一切编排归 engine。

## 当前陷阱

- message.user 三态吸收（id 命中更新 / 本地 echo 就地改 id / 新建）：SSE 常跑赢 HTTP 回执。
- tool.returned 不得把已 rejected 的工具降级为 done（拒绝文案 is_error=false 回流）。
- delivery.created 以 contentHash 幂等（非 event_id）：snapshot 水合后回放同一成果事件不重复入账。

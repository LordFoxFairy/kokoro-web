# ui/hitl — 人在环决策

## 职责
运行中待人处理的决策卡（工具审批 / 询问用户 / 审阅 / 结构化输入）+ 跨会话待批注册表 + 系统通知。

## 公开件
- 决策卡：`ApprovalCard` / `AskUserCard` / `ReviewCard` / `InputCard`（`input-schema.ts` 是输入表单 schema）。
- `awaiting-store.ts`：跨会话待批注册表——`setAwaiting`/`readAwaiting`/`subscribeAwaiting`/`serverAwaiting`。
- `awaiting-notify.ts`：`notifyAwaiting` 系统通知（权限被拒/不支持静默）。

## 协作者
上游：`@/ui/thread` 内联渲染决策卡；`@/ui/shell` 的 `useAwaitingNotify` 驱动注册表与标签页 title。决策提交回引擎 `stageToolDecision`。

## 陷阱
- 注册表是单活跃流下唯一的跨会话待批来源：切走后活跃会话变了但徽标保留。
- 系统通知仅在「新进入待批」时弹一次，重渲染不重复弹。

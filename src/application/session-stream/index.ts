// session-stream 应用层公开面：types（状态类型）、state-mutations（命令式变更/查找/工厂）、
// thread-projection（视图派生）、reducer（applySessionEvent）。
export type {
  SessionMessage,
  SessionStep,
  SessionStreamState,
  SessionSubagent,
  SessionToolCall,
  ThreadItem,
} from "./types"
export {
  appendUserMessage,
  createSessionStreamState,
  findActiveRunId,
  findAwaitingRunId,
  markRunCancelled,
  markToolRejected,
  resolveStaleTools,
} from "./state-mutations"
export type { Segment } from "./thread-projection"
export {
  buildThreadItems,
  computeActivityVersion,
  groupSegments,
} from "./thread-projection"
export { applySessionEvent } from "./reducer"

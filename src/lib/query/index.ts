// 共享查询层公开入口：统一服务态契约（读=useResource / 写=useAsyncAction）+ 缓存失活。
// 各域面板经此接入模块级缓存，取代手搓 useState 取数样板；变更后按 keyPrefix 失活对账。

export { useResource, type ResourceResult } from "./use-resource"
export { useAsyncAction, type AsyncActionResult, type AsyncOutcome } from "./use-async-action"
export { invalidate } from "./resource-store"

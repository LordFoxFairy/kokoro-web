import { useSyncExternalStore } from "react"

// 水合探针：无订阅、稳定快照；配合 useSyncExternalStore 判定客户端首帧后状态。
function subscribeNoop(): () => void {
  return () => {}
}

// 水合后才渲染主内容：rail 与 composer 立即就位，会话线随后淡入。
// 服务端与首帧客户端一致（空占位），消除“空首屏→恢复历史”的刷新闪跳。
// 用 useSyncExternalStore 取代 setState-in-effect：SSR/首帧为 false，水合后翻 true。
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false)
}

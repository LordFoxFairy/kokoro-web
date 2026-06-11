import { useSyncExternalStore } from "react"

// 水合探针：无订阅、稳定快照；配合 useSyncExternalStore 判定客户端首帧后状态。
function subscribeNoop(): () => void {
  return () => {}
}

// SSR/首帧为 false、水合后翻 true：让两者一致以消除“空首屏→恢复历史”的刷新闪跳。
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false)
}

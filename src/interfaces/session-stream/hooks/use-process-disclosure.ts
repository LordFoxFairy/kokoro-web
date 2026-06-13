import { useSyncExternalStore } from "react"

import {
  getDisclosure,
  subscribeDisclosure,
} from "@/application/session-stream/process-disclosure"

// 读取某段过程块的手动 override（持久化、跨刷新）：true/false=手动展开/收起，null=无 override（跟随 live）。
// SSR 用 null 快照保证水合首帧与服务端一致（无 override），随后切到客户端持久值——无 hydration mismatch。
export function useProcessDisclosure(segmentId: string): boolean | null {
  return useSyncExternalStore(
    subscribeDisclosure,
    () => getDisclosure(segmentId),
    () => null,
  )
}

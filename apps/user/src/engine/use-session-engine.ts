"use client"

// 全仓唯一 React 接缝：useSyncExternalStore 快照订阅；命令直接打在 engine 上。

import { useSyncExternalStore } from "react"

import {
  SERVER_ENGINE_SNAPSHOT,
  type EngineSnapshot,
  type SessionEngine,
} from "./machine"

const subscribeNoop = (): (() => void) => () => {}
const serverSnapshot = (): EngineSnapshot => SERVER_ENGINE_SNAPSHOT

// 引擎实例由装配层持有（页面级、仅浏览器创建）；SSR/水合首帧传 null 走 server 快照保证一致。
export function useSessionEngine(engine: SessionEngine | null): EngineSnapshot {
  return useSyncExternalStore(
    engine ? engine.subscribe : subscribeNoop,
    engine ? engine.getSnapshot : serverSnapshot,
    serverSnapshot,
  )
}

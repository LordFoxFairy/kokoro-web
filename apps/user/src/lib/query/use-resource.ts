"use client"

// useResource(key, fetcher)：把模块级缓存 store 接入 React。挂载订阅 key、按需触发取数，
// 返回统一服务态 {data,error,loading,refetch}。fetcher 经 ref 取用——引用变化不重订阅，
// 只有 key 变才换订阅（新 key 走各自缓存/去重）。SSR/未水合恒回 loading。

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"

import {
  getResourceSnapshot,
  refetchResource,
  serverResourceSnapshot,
  subscribeResource,
} from "./resource-store"

export type ResourceResult<T> = {
  data: T | undefined
  error: unknown
  loading: boolean
  refetch: () => void
}

export function useResource<T>(key: string, fetcher: () => Promise<T>): ResourceResult<T> {
  // fetcher 经 ref 取用（初值即当次 fetcher，后续渲染由 effect 同步）：引用变化不重订阅，
  // subscribe/refetch 回调始终调最新 fetcher。ref 写在 effect 内以合规 react-compiler。
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const subscribe = useCallback(
    (onChange: () => void) => subscribeResource(key, () => fetcherRef.current(), onChange),
    [key],
  )

  const snapshot = useSyncExternalStore(
    subscribe,
    () => getResourceSnapshot<T>(key),
    () => serverResourceSnapshot<T>(),
  )

  const refetch = useCallback(() => {
    refetchResource(key, () => fetcherRef.current())
  }, [key])

  return { data: snapshot.data, error: snapshot.error, loading: snapshot.loading, refetch }
}

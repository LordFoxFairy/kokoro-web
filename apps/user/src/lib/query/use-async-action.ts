"use client"

// useAsyncAction(action)：提交类副作用（启停/上传/邀请…）的统一提交态 + 错误归一。
// run(...args) 不抛——回 {ok:true} | {ok:false,error}，调用方据 error（如 HubClientError.code）
// 分支处理，无需自建 try/catch 与 busy/error useState。submitting 期间重复 run 直接忽略
// （防连点）。卸载后不 setState（liveRef 门控）。action 经 ref 取用，引用变化不换 run 标识。

import { useCallback, useEffect, useRef, useState } from "react"

export type AsyncOutcome = { ok: true } | { ok: false; error: unknown }

export type AsyncActionResult<Args extends unknown[]> = {
  run: (...args: Args) => Promise<AsyncOutcome>
  submitting: boolean
  error: unknown
  reset: () => void
}

export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
): AsyncActionResult<Args> {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  // action 经 ref 取用（初值即当次 action，后续渲染由 effect 同步）：run 标识不随 action 引用抖动。
  const actionRef = useRef(action)
  const submittingRef = useRef(false)
  const liveRef = useRef(true)
  useEffect(() => {
    actionRef.current = action
  })
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const run = useCallback(async (...args: Args): Promise<AsyncOutcome> => {
    if (submittingRef.current) {
      return { ok: false, error: undefined } // 提交中：忽略重复触发（防连点）。
    }
    submittingRef.current = true
    setSubmitting(true)
    setError(undefined)
    try {
      await actionRef.current(...args)
      if (liveRef.current) {
        setSubmitting(false)
      }
      submittingRef.current = false
      return { ok: true }
    } catch (caught: unknown) {
      submittingRef.current = false
      if (liveRef.current) {
        setSubmitting(false)
        setError(caught)
      }
      return { ok: false, error: caught }
    }
  }, [])

  const reset = useCallback(() => {
    setError(undefined)
  }, [])

  return { run, submitting, error, reset }
}

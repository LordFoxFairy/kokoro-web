"use client"

// 首页闸（WEB-FACE 面一）：服务端解析品牌后交此客户端组件按会话态分流——
// 有效信封/预览档 → 会话工作台（现行为）；匿名 → 营销落地页。探针未回前渲染空白（不闪登录/落地）。
// 登录卡已迁出到 `/login`（面二），首页不再内联登录表单。

import { LandingPage } from "@/ui/marketing/landing-page"
import { SessionShell } from "@/ui/shell/session-shell"

import { useSessionState } from "./use-session-state"

export function HomeGate({ brandName }: { brandName?: string }) {
  const state = useSessionState()

  if (state === "checking") {
    return null
  }
  if (state === "anonymous") {
    return <LandingPage brandName={brandName} />
  }
  return <SessionShell brandName={brandName} />
}

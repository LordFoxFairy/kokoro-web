import { Suspense } from "react"

import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { SettingsPage } from "@/ui/settings/settings-page"
import { resolveSite } from "@/lib/server/site"

export default async function SettingsRoute() {
  // 服务端按请求 Host 解析站点品牌（SITE-REAL）：与首页/登录同源，缺省档回退默认 Kokoro。
  const host = (await headers()).get("host")
  const site = await resolveSite(host)
  if (site === null) {
    // strict 档 fail-closed：解析失败渲染中性无品牌 404（防多租户品牌串味）。
    notFound()
  }
  // 匿名闸在客户端裁决（SettingsPage 内 useSessionState → 匿名重定向 /login）。
  // Suspense 边界:SettingsPage 用 useSearchParams 读 ?tab=,Next 要求包裹。
  return (
    <Suspense>
      <SettingsPage brandName={site.brand.name} />
    </Suspense>
  )
}

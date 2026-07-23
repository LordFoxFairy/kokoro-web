import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { LoginPanel } from "@/ui/auth/login-panel"
import { resolveSite } from "@/lib/server/site"

export default async function LoginRoute() {
  // 服务端按请求 Host 解析站点品牌（SITE-REAL）：与首页同源，缺省档回退默认 Kokoro。
  const host = (await headers()).get("host")
  const site = await resolveSite(host)
  if (site === null) {
    // strict 档 fail-closed：解析失败渲染中性无品牌 404（防多租户品牌串味）。
    notFound()
  }
  return <LoginPanel brandName={site.brand.name} />
}

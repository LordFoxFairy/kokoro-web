import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { LoginGate } from "@/ui/auth/login-gate"
import { SessionShell } from "@/ui/shell/session-shell"
import { resolveSite } from "@/lib/server/site"

export default async function Home() {
  // 服务端按请求 Host 解析站点品牌（SITE-REAL）：缺省档未接 site 服务时回退默认 Kokoro。
  const host = (await headers()).get("host")
  const site = await resolveSite(host)
  if (site === null) {
    // strict 档 fail-closed：解析失败不退默认品牌，渲染中性无品牌 404（防多租户品牌串味）。
    notFound()
  }
  return (
    <LoginGate>
      <SessionShell brandName={site.brand.name} />
    </LoginGate>
  )
}

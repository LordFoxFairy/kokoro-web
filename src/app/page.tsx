import { headers } from "next/headers"

import { LoginGate } from "@/ui/auth/login-gate"
import { SessionShell } from "@/ui/shell/session-shell"
import { resolveSite } from "@/lib/server/site"

export default async function Home() {
  // 服务端按请求 Host 解析站点品牌（SITE-REAL）：未接 site 服务时回退默认 Kokoro。
  const host = (await headers()).get("host")
  const site = await resolveSite(host)
  return (
    <LoginGate>
      <SessionShell brandName={site.brand.name} />
    </LoginGate>
  )
}

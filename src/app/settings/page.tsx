import { redirect } from "next/navigation"

// 设置已从整页路由改为浮在工作区之上的模态(WEB-FACE 面三)：`/settings?tab=X` 深链兜底——
// 重定向到 `/?settings=X`,由首页 shell 在信封有效时开对应 tab 的模态(匿名则落营销页,不开模态)。
// 品牌/会话态解析全交给 `/`(同源同 host),此处只做参数搬运。
export default async function SettingsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tab = (await searchParams).tab
  const target = typeof tab === "string" && tab.length > 0 ? tab : "account"
  redirect(`/?settings=${encodeURIComponent(target)}`)
}

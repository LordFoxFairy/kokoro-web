import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { resolveSite } from "@/lib/server/site"
import { ReferenceChat } from "@/reference/reference-chat"

export default async function Home(props: {
  readonly searchParams: Promise<{ readonly session?: string | string[] }>
}) {
  const host = (await headers()).get("host")
  const site = await resolveSite(host)
  if (site === null) notFound()
  const rawSessionId = (await props.searchParams).session
  return (
    <ReferenceChat
      brandName={site.brand.name}
      initialSessionId={typeof rawSessionId === "string" ? rawSessionId : undefined}
    />
  )
}

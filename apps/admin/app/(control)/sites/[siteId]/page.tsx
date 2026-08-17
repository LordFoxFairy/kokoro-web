import { notFound } from "next/navigation";

import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeSiteAction } from "@/modules/iam/sites/action-server";
import { SiteDetail } from "@/modules/iam/sites/site-detail";
import { loadSiteDetail } from "@/modules/iam/sites/query";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type Props = Readonly<{
  params: Promise<Readonly<{ siteId: string }>>;
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function SitePage({ params, searchParams }: Props): Promise<React.ReactElement> {
  const { siteId } = await params;
  let result: Awaited<ReturnType<typeof loadSiteDetail>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadSiteDetail(createIamManagementClient(actor.transport), siteId, await searchParams);
  } catch (error) {
    const kind = toIamWebError(error).kind;
    if (kind === "not_found") notFound();
    result = pageState(error);
  }
  if (result === null) notFound();
  return typeof result === "string" ? <PageState kind={result} /> : <SiteDetail view={result} action={executeSiteAction} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

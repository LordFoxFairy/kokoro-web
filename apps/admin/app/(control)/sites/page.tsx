import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeSiteAction } from "@/modules/iam/sites/action-server";
import { loadSites } from "@/modules/iam/sites/query";
import { SiteTable } from "@/modules/iam/sites/site-table";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type Props = Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>;

export default async function SitesPage({ searchParams }: Props): Promise<React.ReactElement> {
  let result: Awaited<ReturnType<typeof loadSites>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadSites(createIamManagementClient(actor.transport), await searchParams);
  } catch (error) { result = pageState(error); }
  return typeof result === "string" ? <PageState kind={result} /> : <SiteTable view={result} action={executeSiteAction} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

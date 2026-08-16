import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { AccessCatalog } from "@/modules/iam/access/access-catalog";
import { loadAccess, parseAccessFilters } from "@/modules/iam/access/query";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type AccessPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function AccessPage({ searchParams }: AccessPageProps): Promise<React.ReactElement> {
  let result: Awaited<ReturnType<typeof loadAccess>> | PageStateKind;
  try {
    const raw = await searchParams;
    parseAccessFilters(raw);
    const actor = await requireIamActor();
    result = await loadAccess(createIamManagementClient(actor.transport), raw);
  } catch (error) {
    result = pageState(error);
  }
  return typeof result === "string" ? <PageState kind={result} /> : <AccessCatalog view={result} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

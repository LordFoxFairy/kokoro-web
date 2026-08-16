import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { AuditEventTable } from "@/modules/iam/audit/event-table";
import { loadAudit, parseAuditFilters } from "@/modules/iam/audit/query";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type AuditPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function AuditPage({ searchParams }: AuditPageProps): Promise<React.ReactElement> {
  let result: Awaited<ReturnType<typeof loadAudit>> | PageStateKind;
  try {
    const raw = await searchParams;
    parseAuditFilters(raw);
    const actor = await requireIamActor();
    result = await loadAudit(createIamManagementClient(actor.transport), raw);
  } catch (error) {
    result = pageState(error);
  }
  return typeof result === "string" ? <PageState kind={result} /> : <AuditEventTable view={result} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

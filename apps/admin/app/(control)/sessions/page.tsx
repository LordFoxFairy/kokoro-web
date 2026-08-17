import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeSessionAction } from "@/modules/iam/sessions/action-server";
import { loadSessions } from "@/modules/iam/sessions/query";
import { SessionTable } from "@/modules/iam/sessions/session-table";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type SessionsPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function SessionsPage({ searchParams }: SessionsPageProps): Promise<React.ReactElement> {
  let result: Awaited<ReturnType<typeof loadSessions>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadSessions(createIamManagementClient(actor.transport), await searchParams);
  } catch (error) {
    result = pageState(error);
  }
  return typeof result === "string" ? (
    <PageState kind={result} />
  ) : (
    <SessionTable view={result} action={executeSessionAction} />
  );
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

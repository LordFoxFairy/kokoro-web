import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeUserAction } from "@/modules/iam/users/action-server";
import { loadUsers } from "@/modules/iam/users/query";
import { UserTable } from "@/modules/iam/users/user-table";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type UsersPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function UsersPage({ searchParams }: UsersPageProps): Promise<React.ReactElement> {
  let result: Awaited<ReturnType<typeof loadUsers>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadUsers(createIamManagementClient(actor.transport), await searchParams);
  } catch (error) {
    result = pageState(error);
  }
  return typeof result === "string"
    ? <PageState kind={result} />
    : <UserTable view={result} action={executeUserAction} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

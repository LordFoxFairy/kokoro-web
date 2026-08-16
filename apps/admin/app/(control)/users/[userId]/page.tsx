import { notFound } from "next/navigation";

import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeSessionAction } from "@/modules/iam/sessions/action-server";
import { executeUserAction } from "@/modules/iam/users/action-server";
import { loadUserDetail } from "@/modules/iam/users/query";
import { UserDetail } from "@/modules/iam/users/user-detail";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type UserPageProps = Readonly<{ params: Promise<Readonly<{ userId: string }>> }>;

export default async function UserPage({ params }: UserPageProps): Promise<React.ReactElement> {
  const { userId } = await params;
  let result: Awaited<ReturnType<typeof loadUserDetail>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadUserDetail(createIamManagementClient(actor.transport), userId);
  } catch (error) {
    result = pageState(error);
  }
  if (result === null) notFound();
  return typeof result === "string"
    ? <PageState kind={result} />
    : <UserDetail view={result} userAction={executeUserAction} sessionAction={executeSessionAction} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

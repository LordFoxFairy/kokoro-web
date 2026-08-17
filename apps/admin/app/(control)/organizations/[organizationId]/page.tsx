import { notFound } from "next/navigation";

import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeMemberAction } from "@/modules/iam/members/action-server";
import { executeOrganizationAction } from "@/modules/iam/organizations/action-server";
import { OrganizationDetail } from "@/modules/iam/organizations/organization-detail";
import { loadOrganizationDetail } from "@/modules/iam/organizations/query";
import { executeOrganizationRoleAction } from "@/modules/iam/roles/action-server";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type OrganizationPageProps = Readonly<{
  params: Promise<Readonly<{ organizationId: string }>>;
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function OrganizationPage({ params, searchParams }: OrganizationPageProps): Promise<React.ReactElement> {
  const { organizationId } = await params;
  let result: Awaited<ReturnType<typeof loadOrganizationDetail>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadOrganizationDetail(
      createIamManagementClient(actor.transport),
      organizationId,
      await searchParams,
    );
  } catch (error) {
    const kind = toIamWebError(error).kind;
    if (kind === "not_found") notFound();
    result = pageState(error);
  }
  if (result === null) notFound();
  return typeof result === "string" ? (
    <PageState kind={result} />
  ) : (
    <OrganizationDetail
      view={result}
      organizationAction={executeOrganizationAction}
      memberAction={executeMemberAction}
      roleAction={executeOrganizationRoleAction}
    />
  );
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

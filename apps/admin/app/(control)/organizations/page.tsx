import { PageState, type PageStateKind } from "@/components/feedback/page-state";
import { executeOrganizationAction } from "@/modules/iam/organizations/action-server";
import { loadOrganizations } from "@/modules/iam/organizations/query";
import { OrganizationTable } from "@/modules/iam/organizations/organization-table";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

type OrganizationsPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function OrganizationsPage({ searchParams }: OrganizationsPageProps): Promise<React.ReactElement> {
  let result: Awaited<ReturnType<typeof loadOrganizations>> | PageStateKind;
  try {
    const actor = await requireIamActor();
    result = await loadOrganizations(createIamManagementClient(actor.transport), await searchParams);
  } catch (error) {
    result = pageState(error);
  }
  return typeof result === "string"
    ? <PageState kind={result} />
    : <OrganizationTable view={result} action={executeOrganizationAction} />;
}

function pageState(error: unknown): PageStateKind {
  if (error instanceof Error && error.message.startsWith("invalid ")) return "malformed";
  const kind = toIamWebError(error).kind;
  if (kind === "forbidden" || kind === "unauthenticated") return "forbidden";
  return kind === "internal" ? "malformed" : "unavailable";
}

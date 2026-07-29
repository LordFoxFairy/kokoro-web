import { IdentityLaunch } from "@kokoro/account-app";
import { parseSiteLegalDocuments, publicLegalDocuments } from "@kokoro/site-bff/site-legal-documents";
import { notFound } from "next/navigation";

import { siteBff } from "../../bff";
import { site } from "../../site-bootstrap";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const bff = siteBff();
  const capabilities = await bff.publicCapabilities();
  if (!capabilities.enabledSurfaceIds.some((surface) => surface === "account" || surface === "identity")) notFound();
  const legalDocuments = parseSiteLegalDocuments(process.env.KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS);
  return <IdentityLaunch brandName={site.displayName} csrfToken={bff.issueBrowserCsrf()} legalDocuments={publicLegalDocuments(legalDocuments)} mode="register" />;
}

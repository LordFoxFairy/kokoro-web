import { IdentityLaunch } from "@kokoro/account-app";
import { notFound } from "next/navigation";

import { siteBff } from "../../bff";
import { site } from "../../site-bootstrap";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const bff = siteBff();
  const capabilities = await bff.publicCapabilities();
  if (!capabilities.enabledSurfaceIds.some((surface) => surface === "account" || surface === "identity")) notFound();
  return <IdentityLaunch brandName={site.displayName} csrfToken={bff.issueBrowserCsrf()} mode="register" />;
}

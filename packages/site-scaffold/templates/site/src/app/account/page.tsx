import { AccountProduct } from "@kokoro/account-app";
import { redirect } from "next/navigation";

import { readOpaqueAuthSession } from "../../auth";
import { siteBff } from "../../bff";
import { site } from "../../site-bootstrap";

export default async function AccountPage() {
  if (await readOpaqueAuthSession() === null) redirect("/login");
  const bff = siteBff();
  return <AccountProduct brandName={site.displayName} csrfToken={bff.issueBrowserCsrf()} />;
}

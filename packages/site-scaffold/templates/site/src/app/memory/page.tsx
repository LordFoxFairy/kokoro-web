import { MemoryProduct } from "@kokoro/memory-app";
import { zMemoryEntryRef } from "@kokoro/site-client";
import { notFound, redirect } from "next/navigation";

import { browserRuntimeScope, readOpaqueAuthSession } from "../../auth";
import { siteBff } from "../../bff";
import { site } from "../../site-bootstrap";

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string | string[] }>;
}) {
  if (!site.enabledProductIds.includes("memory")) notFound();
  const opaque = await readOpaqueAuthSession();
  if (opaque === null) redirect("/login");
  const bff = siteBff();
  const runtime = await bff.assemble(opaque);
  if (!runtime.publicBootstrap.enabledSurfaceIds.includes("memory")) notFound();
  const requested = (await searchParams).entry;
  const initialEntryRef = typeof requested === "string" && zMemoryEntryRef.safeParse(requested).success
    ? requested
    : undefined;
  return <MemoryProduct
    brandName={site.displayName}
    browserRuntimeScope={browserRuntimeScope(opaque, runtime.publicBootstrap.defaultProjectRef)}
    csrfToken={bff.issueBrowserCsrf()}
    initialEntryRef={initialEntryRef}
  />;
}

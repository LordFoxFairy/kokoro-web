import { LibraryProduct } from "@kokoro/media-app";
import { zArtifactRef } from "@kokoro/site-client";
import { notFound, redirect } from "next/navigation";

import { browserRuntimeScope, readOpaqueAuthSession } from "../../auth";
import { siteBff } from "../../bff";
import { site } from "../../site-bootstrap";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ artifact?: string | string[] }>;
}) {
  const opaque = await readOpaqueAuthSession();
  if (opaque === null) redirect("/login");
  const bff = siteBff();
  const runtime = await bff.assemble(opaque);
  const enabled = runtime.publicBootstrap.enabledSurfaceIds.includes("image") &&
    runtime.publicBootstrap.modelOptionCatalogs.some((catalog) => catalog.surfaceId === "image");
  if (!enabled) notFound();
  const requestedArtifactRef = (await searchParams).artifact;
  const initialArtifactRef = typeof requestedArtifactRef === "string" && zArtifactRef.safeParse(requestedArtifactRef).success
    ? requestedArtifactRef
    : null;
  return <LibraryProduct
    brandName={site.displayName}
    browserRuntimeScope={browserRuntimeScope(opaque, runtime.publicBootstrap.defaultProjectRef)}
    csrfToken={bff.issueBrowserCsrf()}
    initialArtifactRef={initialArtifactRef}
  />;
}

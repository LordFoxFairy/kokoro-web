import { ChatProduct } from "@kokoro/chat-app";
import { notFound, redirect } from "next/navigation";

import { readOpaqueAuthSession } from "../auth";
import { siteBff } from "../bff";
import { site } from "../site-bootstrap";

export default async function Home(props: { readonly searchParams: Promise<{ readonly session?: string | string[] }> }) {
  const opaque = await readOpaqueAuthSession();
  if (opaque === null) redirect("/login");
  const bff = siteBff();
  const runtime = await bff.assemble(opaque);
  const chatEnabled = runtime.publicBootstrap.enabledSurfaceIds.includes("chat") &&
    runtime.publicBootstrap.modelOptionCatalogs.some((catalog) => catalog.surfaceId === "chat");
  if (!chatEnabled) notFound();
  const selected = (await props.searchParams).session;
  return (
    <ChatProduct
      bootstrap={runtime.publicBootstrap}
      brandName={site.displayName}
      csrfToken={bff.issueBrowserCsrf()}
      initialSessionId={typeof selected === "string" ? selected : undefined}
    />
  );
}

import "server-only";

import { parseSiteLegalDocuments } from "@kokoro/site-bff/site-legal-documents";

import { siteBff } from "./bff";

export function siteAuthSecret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value !== value.trim() || value.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 exact non-whitespace characters");
  }
  return value;
}

export function sitePublicOrigin(): string {
  siteAuthSecret();
  const value = process.env.KOKORO_SITE_PUBLIC_ORIGIN?.trim();
  if (!value || process.env.AUTH_URL?.trim() !== value) {
    throw new Error("AUTH_URL must exactly equal KOKORO_SITE_PUBLIC_ORIGIN");
  }
  return value;
}

export function siteLegalDocuments() {
  return parseSiteLegalDocuments(process.env.KOKORO_SITE_REGISTRATION_LEGAL_DOCUMENTS);
}

/** Startup gate for every credential, binding and Site-local legal authority used by production routes. */
export function validateSiteRuntimeConfiguration(): void {
  sitePublicOrigin();
  siteBff();
}

export async function validateSiteRuntimeReadiness(): Promise<void> {
  const capabilities = await siteBff().publicCapabilities();
  if (capabilities.enabledSurfaceIds.some((surface) => surface === "account" || surface === "identity")) {
    siteLegalDocuments();
  }
}

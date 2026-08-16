import { readFile } from "node:fs/promises";
import path from "node:path";

import { filesBelow } from "./evidence";

export const expectedAdminRoutes = Object.freeze([
  "/",
  "/access",
  "/api/auth/[...nextauth]",
  "/audit",
  "/auth/verify",
  "/login",
  "/organizations",
  "/organizations/[organizationId]",
  "/sessions",
  "/users",
  "/users/[userId]",
]);

export type ProductionBoundaryResult = Readonly<{
  routes: readonly string[];
  scannedFiles: number;
  violations: readonly string[];
}>;

const frameworkRoutes = new Set(["/_global-error", "/_not-found", "/favicon.ico"]);
const readableArtifact = /\.(?:html|js|json|map|mjs|txt)$/u;
const databaseAuthority = /(?:@prisma|PrismaClient|DATABASE_URL|(?:from|join)\s+["'`]?(?:iam_user|iam_session|iam_organization))/iu;
const siblingPath = /(?:\/Users\/[^\s"']+\/kokoro-iam\/|\.\.\/kokoro-iam\/)/u;
const generatedClient = /(?:generated\/iam|kokoro\.iam\.v1)/u;
const clientSecretName = /(?:AUTH_SECRET_FILE|EMAIL_SERVER_PASSWORD_FILE|KOKORO_IAM_ADMIN_WEB_TOKEN_FILE)/u;

export async function scanProductionBundle(
  appRoot: string,
  forbiddenValues: readonly string[],
): Promise<ProductionBoundaryResult> {
  const nextRoot = path.join(appRoot, ".next");
  const manifest = JSON.parse(
    await readFile(path.join(nextRoot, "app-path-routes-manifest.json"), "utf8"),
  ) as unknown;
  if (!isStringRecord(manifest)) throw new Error("invalid Next app route manifest");
  const actualRoutes = [...new Set(Object.values(manifest))]
    .filter((route) => !frameworkRoutes.has(route))
    .sort();
  const violations: string[] = [];
  for (const route of actualRoutes.filter((route) => !expectedAdminRoutes.includes(route))) {
    violations.push(`unexpected route: ${route}`);
  }
  for (const route of expectedAdminRoutes.filter((route) => !actualRoutes.includes(route))) {
    violations.push(`missing route: ${route}`);
  }

  const artifactFiles = (await filesBelow(nextRoot)).filter((file) => readableArtifact.test(file));
  for (const file of artifactFiles) {
    const relative = path.relative(nextRoot, file);
    const source = await readFile(file, "utf8");
    const isClient = relative.startsWith(`static${path.sep}`);
    if (databaseAuthority.test(source)) violations.push(`${relative}: database authority`);
    if (siblingPath.test(source)) violations.push(`${relative}: sibling path`);
    for (const value of forbiddenValues.filter((candidate) => candidate.length > 0)) {
      if (source.includes(value)) violations.push(`${relative}: secret value`);
    }
    if (isClient && generatedClient.test(source)) violations.push(`${relative}: generated IAM client chunk`);
    if (isClient && clientSecretName.test(source)) violations.push(`${relative}: secret name in client chunk`);
  }

  const routesManifestPath = path.join(nextRoot, "routes-manifest.json");
  const routesManifestFile = artifactFiles.find((file) => file === routesManifestPath);
  if (routesManifestFile !== undefined) {
    const routesManifest = JSON.parse(await readFile(routesManifestFile, "utf8")) as unknown;
    if (hasWildcardRewrite(routesManifest)) violations.push("wildcard API rewrite");
  }

  return Object.freeze({
    routes: Object.freeze(actualRoutes),
    scannedFiles: artifactFiles.length,
    violations: Object.freeze([...new Set(violations)].sort()),
  });
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function hasWildcardRewrite(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rewrites = Reflect.get(value, "rewrites");
  if (!Array.isArray(rewrites)) return false;
  return rewrites.some((entry) => (
    typeof entry === "object"
    && entry !== null
    && typeof Reflect.get(entry, "source") === "string"
    && String(Reflect.get(entry, "source")).includes(":path*")
  ));
}

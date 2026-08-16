import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
  createSourceFile,
  forEachChild,
  isCallExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isPropertyAccessExpression,
  isStringLiteralLike,
  isTaggedTemplateExpression,
  type Node,
} from "typescript";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");
const secretEnvironmentNames = new Set([
  "AUTH_SECRET_FILE",
  "EMAIL_SERVER_PASSWORD_FILE",
  "KOKORO_IAM_ADMIN_WEB_TOKEN_FILE",
]);
const forbiddenClientImports = [
  /^@connectrpc\/connect-node(?:\/|$)/u,
  /^@prisma(?:\/|$)/u,
  /^@\/generated\/iam(?:\/|$)/u,
  /^@\/lib\/prisma(?:\/|$)/u,
  /^@\/server(?:\/|$)/u,
  /^(?:\.\.\/)+generated\/iam(?:\/|$)/u,
  /^(?:\.\.\/)+server(?:\/|$)/u,
  /^(?:better-sqlite3|mysql2|pg|postgres)(?:\/|$)/u,
  /^@libsql\/client(?:\/|$)/u,
];

describe("Admin server-only IAM boundary", () => {
  it("WEB-CONTRACT-BOUNDARY-001 marks every handwritten server module as server-only", async () => {
    const files = (await filesBelow(resolve(appRoot, "server"))).filter((path) => path.endsWith(".ts"));

    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source.startsWith('import "server-only";'), path).toBe(true);
    }
  });

  it("WEB-CONTRACT-BOUNDARY-001 keeps Node IAM SQL Prisma and secret names out of Client Components", async () => {
    const runtimeRoots = ["app", "components", "lib", "modules"];
    const dependencyRoots = [...runtimeRoots, "i18n", "server"];
    const dependencyFiles = (await Promise.all(
      dependencyRoots.map((root) => filesBelow(resolve(appRoot, root))),
    )).flat().filter((candidate) => /\.[cm]?[jt]sx?$/u.test(candidate));
    const sources = new Map(await Promise.all(dependencyFiles.map(async (path) => [path, await readFile(path, "utf8")] as const)));
    const files = dependencyFiles.filter((path) => runtimeRoots.some((root) => path.startsWith(resolve(appRoot, root))));
    const clientFiles: string[] = [];

    for (const path of files) {
      const source = sources.get(path) ?? "";
      if (!source.startsWith('"use client";')) continue;
      clientFiles.push(path);
      expect([
        ...clientBoundaryViolations(source, path),
        ...clientDependencyViolations(path, sources),
      ], path).toEqual([]);
    }

    expect(clientFiles.length).toBeGreaterThan(0);
  });
});

function clientBoundaryViolations(source: string, path: string): string[] {
  const sourceFile = createSourceFile(
    path,
    source,
    ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ScriptKind.TSX : ScriptKind.TS,
  );
  const violations: string[] = [];

  function visit(node: Node): void {
    if (isImportDeclaration(node) && isStringLiteralLike(node.moduleSpecifier)) {
      checkModuleSpecifier(node.moduleSpecifier.text);
    }
    if (isExportDeclaration(node) && node.moduleSpecifier !== undefined && isStringLiteralLike(node.moduleSpecifier)) {
      checkModuleSpecifier(node.moduleSpecifier.text);
    }
    if (
      isCallExpression(node)
      && node.arguments.length === 1
      && isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === SyntaxKind.ImportKeyword
        || (isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      checkModuleSpecifier(node.arguments[0].text);
    }
    if (isTaggedTemplateExpression(node) && isSqlTag(node.tag)) {
      violations.push("SQL tagged template");
    }
    const environmentName = secretEnvironmentName(node);
    if (environmentName !== null) violations.push(`secret environment access: ${environmentName}`);
    forEachChild(node, visit);
  }

  function checkModuleSpecifier(specifier: string): void {
    if (forbiddenClientImports.some((pattern) => pattern.test(specifier))) {
      violations.push(`forbidden import: ${specifier}`);
    }
  }

  visit(sourceFile);
  return violations;
}

function clientDependencyViolations(entry: string, sources: ReadonlyMap<string, string>): string[] {
  const visited = new Set<string>();
  const violations = new Set<string>();

  function visit(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);
    const source = sources.get(path);
    if (source === undefined) return;
    for (const specifier of localModuleSpecifiers(source, path)) {
      const dependency = resolveLocalModule(path, specifier, sources);
      if (dependency === null) continue;
      const dependencySource = sources.get(dependency) ?? "";
      if (dependencySource.startsWith('import "server-only";')) {
        violations.add(`server-only dependency: ${specifier}`);
      } else {
        visit(dependency);
      }
    }
  }

  visit(entry);
  return [...violations].sort();
}

function localModuleSpecifiers(source: string, path: string): string[] {
  const sourceFile = createSourceFile(
    path,
    source,
    ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ScriptKind.TSX : ScriptKind.TS,
  );
  const specifiers: string[] = [];
  forEachChild(sourceFile, (node) => {
    if (
      (isImportDeclaration(node) || isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
  });
  return specifiers;
}

function resolveLocalModule(
  importer: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(appRoot, specifier.slice(2))
    : specifier.startsWith(".") ? resolve(dirname(importer), specifier) : null;
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ];
  if (base.endsWith(".js")) candidates.push(base.slice(0, -3) + ".ts");
  return candidates.find((candidate) => sources.has(candidate)) ?? null;
}

function isSqlTag(node: Node): boolean {
  return (isIdentifier(node) && node.text === "sql")
    || (isPropertyAccessExpression(node) && node.name.text === "sql");
}

function secretEnvironmentName(node: Node): string | null {
  if (isPropertyAccessExpression(node) && isProcessEnvironment(node.expression)) {
    return secretEnvironmentNames.has(node.name.text) ? node.name.text : null;
  }
  if (
    isElementAccessExpression(node)
    && isProcessEnvironment(node.expression)
    && node.argumentExpression !== undefined
    && isStringLiteralLike(node.argumentExpression)
  ) {
    return secretEnvironmentNames.has(node.argumentExpression.text) ? node.argumentExpression.text : null;
  }
  return null;
}

function isProcessEnvironment(node: Node): boolean {
  return isPropertyAccessExpression(node)
    && isIdentifier(node.expression)
    && node.expression.text === "process"
    && node.name.text === "env";
}

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const pathname = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(pathname));
    else files.push(pathname);
  }
  return files.sort();
}

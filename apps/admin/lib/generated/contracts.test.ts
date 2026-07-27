import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { AdminAuthService } from "./contracts/kokoro/platform/admin/v1/admin_auth_pb";

const libRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(libRoot, "../..");

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".next", "node_modules"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function runtimeImports(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const hasRuntimeBinding =
        clause === undefined ||
        (!clause.isTypeOnly &&
          (clause.name !== undefined ||
            clause.namedBindings === undefined ||
            ts.isNamespaceImport(clause.namedBindings) ||
            clause.namedBindings.elements.some((element) => !element.isTypeOnly)));
      if (hasRuntimeBinding) imports.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(source, visit);

  return imports;
}

function resolveLocalImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  let base = specifier.startsWith("@/")
    ? resolve(appRoot, specifier.slice(2))
    : resolve(dirname(importer), specifier);
  if (base.endsWith(".js")) base = base.slice(0, -3);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  return candidates.find((candidate) => sourceFileSet.has(candidate)) ?? null;
}

const sourceFiles = sourceFilesUnder(appRoot);
const sourceFileSet = new Set(sourceFiles);

function clientReachableFiles(): Set<string> {
  const roots = sourceFiles.filter((path) => {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const first = source.statements[0];
    return (
      first !== undefined &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client"
    );
  });
  const reachable = new Set(roots);
  const pending = [...roots];

  while (pending.length > 0) {
    const importer = pending.pop()!;
    for (const specifier of runtimeImports(importer)) {
      const imported = resolveLocalImport(importer, specifier);
      if (imported !== null && !reachable.has(imported)) {
        reachable.add(imported);
        pending.push(imported);
      }
    }
  }

  return reachable;
}

describe("generated Admin Auth contract mirror", () => {
  it("exports the six generated service methods", () => {
    expect(Object.keys(AdminAuthService.method)).toEqual([
      "getOperatorByEmail",
      "getOperator",
      "createVerificationToken",
      "consumeVerificationToken",
      "recordAuthEvent",
      "getCommandReceipt",
    ]);
  });

  it("is consumed by the server auth client without a second transport schema", () => {
    const source = readFileSync(resolve(libRoot, "../auth/client.ts"), "utf8");
    expect(source).toContain("AdminAuthService");
    expect(source).toContain("@connectrpc/connect-node");
    expect(source).toContain('import "server-only"');
    expect(source).not.toContain('from "zod"');
    expect(source).not.toContain("/internal/admin-auth/v1");
    expect(source).not.toContain("x-kokoro-contract-version");
  });

  it("keeps generated descriptors and the Node transport out of client component bundles", () => {
    const generatedRoot = resolve(appRoot, "lib/generated/contracts");
    const authClient = resolve(appRoot, "lib/auth/client.ts");
    const leaked = [...clientReachableFiles()]
      .filter((path) => path === authClient || path.startsWith(`${generatedRoot}${sep}`))
      .map((path) => relative(appRoot, path))
      .sort();

    expect(leaked).toEqual([]);
  });
});

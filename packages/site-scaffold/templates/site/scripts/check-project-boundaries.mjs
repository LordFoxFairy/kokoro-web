import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const forbidden = [
  ["runtime Host switching", /(?:request|req)\.headers(?:\.host|\.get\(\s*["'](?:host|x-forwarded-host)["']\s*\)|\[\s*["'](?:host|x-forwarded-host)["']\s*\])/iu],
  ["framework Host switching", /\bheaders\(\)\s*(?:\.get\(\s*["'](?:host|x-forwarded-host)["']\s*\)|\.host)/iu],
  ["URL-derived Host switching", /new URL\([^)]*\)\.(?:host|hostname)/iu],
  ["raw Platform environment", /process\.env(?:\.(?:PLATFORM_URL|DATABASE_URL|NEXT_PUBLIC_PLATFORM_URL)|\[\s*["'](?:PLATFORM_URL|DATABASE_URL|NEXT_PUBLIC_PLATFORM_URL)["']\s*\])/u],
  ["raw Platform URL", /https?:\/\/[^\s"']*platform/iu],
  ["forbidden backend/admin import", /(?:from\s*|import\s*\(|require\s*\()["'](?:@kokoro\/admin|@kokoro\/platform|@prisma\/client)/u],
  ["shared account/session semantics", /\bshared(?:Account|Session)\b/u],
];

const skippedDirectories = new Set([".git", ".next", "node_modules", "vendor"]);
const scannedExtensions = /\.(?:cjs|env|js|json|jsx|mjs|ts|tsx|yaml|yml)$/u;

async function projectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !skippedDirectories.has(entry.name)) {
      files.push(...(await projectFiles(path)));
    } else if (
      entry.isFile() &&
      path !== "scripts/check-project-boundaries.mjs" &&
      (scannedExtensions.test(entry.name) || entry.name.startsWith(".env"))
    ) {
      files.push(path);
    }
  }
  return files;
}

for (const path of await projectFiles(".")) {
  const source = await readFile(path, "utf8");
  for (const [rule, pattern] of forbidden) {
    assert.doesNotMatch(source, pattern, `${relative(".", path)} violates Site boundary: ${rule}`);
  }
}
console.log(`site_project_boundaries_ok:${basename(process.cwd())}`);

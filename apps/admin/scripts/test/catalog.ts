import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const categorySchema = z.enum(["unit", "component", "contract", "integration", "security", "pair_e2e"]);
const statusSchema = z.enum(["PLANNED", "NOT_STARTED", "PASS", "FAIL"]);

const caseSchema = z.object({
  id: z.string().regex(/^(?:WEB-(?:UNIT|COMP|CONTRACT|INT|SEC)|IAM-(?:SEC|E2E))-[A-Z0-9]+-[0-9]{3}$/u),
  category: categorySchema,
  status: statusSchema,
  title: z.string().trim().min(1).max(240),
  requirements: z.array(z.string().regex(/^WEB-IAM-FR-[A-Z0-9]+-[0-9]{3}$/u)),
  acceptance: z.array(z.string().regex(/^WEB-IAM-ACC-[A-Z]+-[0-9]{3}$/u)),
  testFile: z.string().regex(/\.(?:test|spec)\.tsx?$/u).nullable(),
  evidence: z.array(z.string().trim().min(1).max(64)).min(1),
  retries: z.literal(0),
}).strict().superRefine((value, context) => {
  const pairSpec = value.testFile?.endsWith(".spec.ts") === true || value.testFile?.endsWith(".spec.tsx") === true;
  const repositoryTest = value.testFile?.endsWith(".test.ts") === true || value.testFile?.endsWith(".test.tsx") === true;
  if (value.category === "pair_e2e" ? !pairSpec : !repositoryTest) {
    context.addIssue({
      code: "custom",
      path: ["testFile"],
      message: value.category === "pair_e2e" ? "pair case requires a Playwright spec" : "repository case requires a Vitest test",
    });
  }
});

const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  acceptance: z.object({
    retryCount: z.literal(0),
    chromiumRounds: z.literal(2),
    freshFixturePerRound: z.literal(true),
    allowSkip: z.literal(false),
    allowTodo: z.literal(false),
    realIamRequired: z.literal(true),
    realPostgresqlRequired: z.literal(true),
    realMailRequired: z.literal(true),
  }).strict(),
  cases: z.array(caseSchema).min(1),
}).strict();

export type P0Catalog = z.infer<typeof catalogSchema>;

export async function loadP0Catalog(path: string): Promise<P0Catalog> {
  const source = await readFile(path, "utf8");
  const value: unknown = parse(source);
  return catalogSchema.parse(value);
}

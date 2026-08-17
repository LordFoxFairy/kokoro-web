import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const caseRecordSchema = z.object({
  caseId: z.string().min(1),
  status: z.enum(["PASS", "FAIL"]),
  retries: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  steps: z.array(z.unknown()),
}).passthrough();

export type PairCaseRecord = Readonly<z.infer<typeof caseRecordSchema> & { failure?: string }>;

export async function loadPairCaseLedger(
  casesRoot: string,
  expectedIds: readonly string[],
): Promise<readonly PairCaseRecord[]> {
  const records = await Promise.all(expectedIds.map(async (caseId): Promise<PairCaseRecord> => {
    try {
      const pathname = path.join(casesRoot, caseId, "case.json");
      const record = caseRecordSchema.parse(JSON.parse(await readFile(pathname, "utf8")) as unknown);
      if (record.caseId !== caseId) throw new Error("case evidence identity mismatch");
      return Object.freeze(record);
    } catch (error) {
      const failure = error instanceof Error && error.message.includes("identity mismatch")
        ? "case evidence identity mismatch"
        : "case evidence is missing";
      return Object.freeze({ caseId, status: "FAIL", retries: 0, attempts: 0, steps: [], failure });
    }
  }));
  return Object.freeze(records);
}

import "server-only";

import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const logRecordSchema = z.object({
  event: z.string().regex(/^[a-z][a-z0-9_.-]{2,95}$/u),
  requestId: uuid,
  result: z.enum(["success", "error"]),
  kind: z.enum([
    "invalid",
    "unauthenticated",
    "forbidden",
    "not_found",
    "conflict",
    "in_progress",
    "last_owner",
    "precondition",
    "unavailable",
    "internal",
  ]).optional(),
  service: z.string().regex(/^[A-Za-z][A-Za-z0-9.]{1,159}$/u).optional(),
  method: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,95}$/u).optional(),
  durationMs: z.number().finite().nonnegative().max(900_000).optional(),
  commandId: uuid.optional(),
}).strict();

export type IamLogRecord = z.input<typeof logRecordSchema>;

export function serializeIamLog(record: IamLogRecord): string {
  const parsed = logRecordSchema.safeParse(record);
  if (!parsed.success) throw new Error("invalid IAM log record");
  return JSON.stringify(parsed.data);
}

export function writeIamLog(record: IamLogRecord, sink: Pick<NodeJS.WriteStream, "write"> = process.stdout): void {
  sink.write(`${serializeIamLog(record)}\n`);
}

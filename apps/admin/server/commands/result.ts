import "server-only";

import type { IamWebError } from "../iam/error";

export type CommandActionResult =
  | Readonly<{ status: "success"; commandId: string; replayed: boolean }>
  | Readonly<{
      status: "error";
      commandId: string;
      kind: IamWebError["kind"];
      requestId: string;
      field?: string;
    }>;

export function commandError(commandId: string, error: IamWebError): CommandActionResult {
  return Object.freeze({
    status: "error",
    commandId,
    kind: error.kind,
    requestId: error.requestId,
    ...(error.field === undefined ? {} : { field: error.field }),
  });
}

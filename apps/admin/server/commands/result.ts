import "server-only";

import type { CommandActionResult } from "../../lib/command-result";
import type { IamWebError } from "../iam/error";

export type { CommandActionResult } from "../../lib/command-result";

export function commandError(commandId: string, error: IamWebError): CommandActionResult {
  return Object.freeze({
    status: "error",
    commandId,
    kind: error.kind,
    requestId: error.requestId,
    ...(error.field === undefined ? {} : { field: error.field }),
  });
}

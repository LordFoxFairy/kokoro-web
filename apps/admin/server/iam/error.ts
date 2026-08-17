import "server-only";

import { Code, ConnectError } from "@connectrpc/connect";

import { ErrorDetailSchema } from "../../generated/iam/proto/kokoro/common/v1/error_pb";
import type { CommandErrorKind } from "../../lib/command-result";

export type IamWebErrorKind = CommandErrorKind;

export type IamWebError = Readonly<{
  kind: IamWebErrorKind;
  requestId: string;
  field?: string;
}>;

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fields = new Set([
  "command_id",
  "code",
  "created_after",
  "created_before",
  "email",
  "expected_version",
  "identifier",
  "member_id",
  "name",
  "organization_id",
  "permission_key",
  "query",
  "reason",
  "role_key",
  "session_id",
  "site_id",
  "slug",
  "status",
  "user_id",
]);

const reasonKinds: Readonly<Record<string, IamWebErrorKind>> = {
  invalid_argument: "invalid",
  unauthenticated: "unauthenticated",
  invalid_credentials: "unauthenticated",
  workload_unauthenticated: "unauthenticated",
  permission_denied: "forbidden",
  workload_forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  command_digest_mismatch: "conflict",
  command_in_progress: "in_progress",
  last_owner: "last_owner",
  failed_precondition: "precondition",
  unavailable: "unavailable",
};

function kindFromCode(code: Code): IamWebErrorKind {
  switch (code) {
    case Code.InvalidArgument:
      return "invalid";
    case Code.Unauthenticated:
      return "unauthenticated";
    case Code.PermissionDenied:
      return "forbidden";
    case Code.NotFound:
      return "not_found";
    case Code.AlreadyExists:
      return "conflict";
    case Code.Aborted:
      return "in_progress";
    case Code.FailedPrecondition:
      return "precondition";
    case Code.Unavailable:
    case Code.DeadlineExceeded:
      return "unavailable";
    default:
      return "internal";
  }
}

export function toIamWebError(error: unknown): IamWebError {
  if (!(error instanceof ConnectError)) return Object.freeze({ kind: "internal", requestId: "" });
  const detail = error.findDetails(ErrorDetailSchema)[0];
  const kind = detail === undefined ? kindFromCode(error.code) : reasonKinds[detail.reason] ?? kindFromCode(error.code);
  const requestId = detail !== undefined && requestIdPattern.test(detail.requestId) ? detail.requestId : "";
  const field = detail !== undefined && fields.has(detail.field) ? detail.field : undefined;
  return Object.freeze({ kind, requestId, ...(field === undefined ? {} : { field }) });
}

import type { MessageKey } from "@/i18n/messages";
import type { CommandErrorKind } from "@/lib/command-result";

const errorKeys: Readonly<Record<CommandErrorKind, MessageKey>> = {
  invalid: "error.invalid",
  unauthenticated: "error.unauthenticated",
  forbidden: "error.forbidden",
  not_found: "error.notFound",
  conflict: "error.conflict",
  in_progress: "error.inProgress",
  last_owner: "error.lastOwner",
  precondition: "error.precondition",
  unavailable: "error.unavailable",
  internal: "error.internal",
};

export function commandErrorKey(kind: CommandErrorKind): MessageKey {
  return errorKeys[kind];
}

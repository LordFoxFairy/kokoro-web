export type CommandErrorKind =
  | "invalid"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "in_progress"
  | "last_owner"
  | "precondition"
  | "unavailable"
  | "internal";

export type CommandActionResult =
  | Readonly<{ status: "success"; commandId: string; replayed: boolean }>
  | Readonly<{
      status: "error";
      commandId: string;
      kind: CommandErrorKind;
      requestId: string;
      field?: string;
    }>;

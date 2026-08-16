export type OverviewState =
  | Readonly<{
      status: "ready";
      administrator: Readonly<{ email: string; id: string }>;
      actorExpiresAt: string;
      recentEvents: readonly Readonly<{
        id: string;
        kind: string;
        requestId: string;
        commandId: string | null;
        createdAt: string;
      }>[];
    }>
  | Readonly<{ status: "unavailable" | "malformed" }>;

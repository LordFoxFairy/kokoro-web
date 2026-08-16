import "server-only";

import { randomUUID } from "node:crypto";

import type { IamManagementClient } from "../../../server/iam/management-client";
import type { OverviewState } from "./schema";

export async function loadOverview(
  client: IamManagementClient,
  input: Readonly<{
    administrator: Readonly<{ email: string; id: string }>;
    actorExpiresAt: Date;
  }>,
): Promise<OverviewState> {
  const events = await client.listSecurityEvents({ requestId: randomUUID(), limit: 10 });
  return Object.freeze({
    status: "ready",
    administrator: Object.freeze({ ...input.administrator }),
    actorExpiresAt: input.actorExpiresAt.toISOString(),
    recentEvents: Object.freeze(events.items.map((event) => Object.freeze({
      id: event.id,
      kind: event.kind,
      requestId: event.requestId,
      commandId: event.commandId,
      createdAt: event.createdAt.toISOString(),
    }))),
  });
}

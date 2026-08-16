import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";
import { SessionSummaryRecordSchema } from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { createSessionActionHandler } from "../../modules/iam/sessions/actions";
import { createIamManagementClient } from "../../server/iam/management-client";

const userId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const sessionId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const commandId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const now = new Date("2026-08-16T10:00:00.000Z");

describe("IAM Session server actions", () => {
  it("WEB-INT-SESSION-002 lists safe summaries and revokes one or all with stable commands", async () => {
    const commands: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamSessionService, {
        listSessions: () => ({ sessions: [session()], page: { nextCursor: "next/cursor" } }),
        revokeSession: (request) => {
          commands.push(request.command?.commandId ?? "");
          return { revoked: true, replayed: false };
        },
        revokeAllSessions: (request) => {
          commands.push(request.command?.commandId ?? "");
          return { revokedCount: 1, replayed: true };
        },
      });
    });
    const revalidated: string[] = [];
    const client = createIamManagementClient(transport);
    const page = await client.listSessions({ requestId, userId, limit: 25 });
    const handle = createSessionActionHandler({
      loadClient: async () => client,
      revalidatePath: (path) => revalidated.push(path),
    });

    expect(page.nextCursor).toBe("next/cursor");
    expect(page.items[0]).toMatchObject({ id: sessionId, userId });
    expect(JSON.stringify(page)).not.toMatch(/token|bearer/iu);
    expect(await handle({
      operation: "revoke",
      sessionId,
      requestId,
      commandId,
      reason: "Device lost",
    })).toEqual({ status: "success", commandId, replayed: false });
    expect(await handle({
      operation: "revoke-all",
      userId,
      requestId,
      commandId,
      reason: "Account recovery",
    })).toEqual({ status: "success", commandId, replayed: true });
    expect(commands).toEqual([commandId, commandId]);
    expect(revalidated).toEqual(expect.arrayContaining(["/sessions", `/users/${userId}`]));
  });
});

function session() {
  return create(SessionSummaryRecordSchema, {
    id: sessionId,
    userId,
    expires: timestampFromDate(new Date("2026-08-17T10:00:00.000Z")),
    createdAt: timestampFromDate(now),
    updatedAt: timestampFromDate(now),
  });
}

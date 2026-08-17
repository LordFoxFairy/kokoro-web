import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { IamAdministrationService } from "../../generated/iam/proto/kokoro/iam/v1/administration_pb";
import { SecurityEventRecordSchema } from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import { auditHref } from "../../modules/iam/audit/url";
import { loadAudit, parseAuditFilters } from "../../modules/iam/audit/query";
import { loadOverview } from "../../modules/iam/overview/query";
import { createIamManagementClient } from "../../server/iam/management-client";

const actorUserId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const targetUserId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const organizationId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const siteId = "3598c32a-c62b-4803-92c2-b5baaf507d9f";
const commandId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const requestId = "df486566-7614-461f-a72c-1b3d4ea9e985";
const createdAfter = "2026-08-16T12:00:00.000Z";
const createdBefore = "2026-08-16T13:00:00.000Z";

describe("IAM SecurityEvent audit query", () => {
  it("WEB-INT-AUDIT-001 forwards every exact filter and retains correlation with cursor pagination", async () => {
    const observed: Record<string, unknown>[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listSecurityEvents: (request) => {
          observed.push(request);
          return {
            events: [event()],
            page: { nextCursor: "next/cursor" },
            statistics: { total: BigInt(7), byKind: [{ kind: "member.changed", count: BigInt(7) }] },
          };
        },
      });
    });

    const view = await loadAudit(createIamManagementClient(transport), {
      kind: "  member.changed  ",
      actorUserId,
      targetUserId,
      organizationId,
      siteId,
      commandId,
      createdAfter,
      createdBefore,
      cursor: "current/cursor",
      limit: "999",
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual(expect.objectContaining({
      kind: "member.changed",
      actorUserId,
      targetUserId,
      organizationId,
      siteId,
      commandId,
      page: expect.objectContaining({ cursor: "current/cursor", limit: 100 }),
    }));
    expect(timestampDate((observed[0]?.createdAfter ?? missingTimestamp()) as never).toISOString()).toBe(createdAfter);
    expect(timestampDate((observed[0]?.createdBefore ?? missingTimestamp()) as never).toISOString()).toBe(createdBefore);
    expect(view.nextCursor).toBe("next/cursor");
    expect(view.items).toEqual([expect.objectContaining({
      kind: "member.changed",
      requestId,
      commandId,
      metadata: { roleKey: "member" },
    })]);
    expect(auditHref(view.filters, "next/cursor")).toBe(
      `/audit?kind=member.changed&actorUserId=${actorUserId}&targetUserId=${targetUserId}`
      + `&organizationId=${organizationId}&siteId=${siteId}&commandId=${commandId}`
      + `&createdAfter=${encodeURIComponent(createdAfter)}&createdBefore=${encodeURIComponent(createdBefore)}`
      + "&limit=100&cursor=next%2Fcursor",
    );
  });

  it("WEB-INT-AUDIT-001 rejects malformed identifiers time ranges arrays and cursors before RPC", () => {
    expect(() => parseAuditFilters({ actorUserId: "not-a-uuid" })).toThrow("invalid audit filters");
    expect(() => parseAuditFilters({ kind: ["one", "two"] })).toThrow("invalid audit filters");
    expect(() => parseAuditFilters({ createdAfter: "2026-08-16" })).toThrow("invalid audit filters");
    expect(() => parseAuditFilters({ createdAfter: createdBefore, createdBefore: createdAfter }))
      .toThrow("invalid audit filters");
    expect(() => parseAuditFilters({ cursor: "x".repeat(513) })).toThrow("invalid audit filters");
  });

  it("WEB-INT-AUDIT-001 requests exactly the ten latest events for the overview", async () => {
    let observedLimit: number | undefined;
    const transport = createRouterTransport((router) => {
      router.service(IamAdministrationService, {
        listSecurityEvents: (request) => {
          observedLimit = request.page?.limit;
          return { events: [event()], page: {}, statistics: { total: BigInt(1), byKind: [] } };
        },
      });
    });

    const state = await loadOverview(createIamManagementClient(transport), {
      administrator: { id: actorUserId, email: "admin@example.com" },
    });

    expect(observedLimit).toBe(10);
    expect(state).toEqual(expect.objectContaining({
      status: "ready",
      recentEvents: [expect.objectContaining({ requestId, commandId })],
    }));
  });
});

function event() {
  return create(SecurityEventRecordSchema, {
    id: "0dbc85ab-70fb-4362-8854-e4834be725ec",
    kind: "member.changed",
    actorUserId,
    targetUserId,
    organizationId,
    siteId,
    sessionId: "e0e3e8fc-b867-45e3-bcc9-4942c1a51985",
    requestId,
    commandId,
    metadataJson: JSON.stringify({ roleKey: "member", reason: "not rendered" }),
    createdAt: timestampFromDate(new Date("2026-08-16T12:30:00.000Z")),
  });
}

function missingTimestamp(): never {
  throw new Error("timestamp missing");
}

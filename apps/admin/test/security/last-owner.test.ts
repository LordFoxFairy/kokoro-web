import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ErrorDetailSchema } from "../../generated/iam/proto/kokoro/common/v1/error_pb";
import { IamOrganizationService } from "../../generated/iam/proto/kokoro/iam/v1/organization_pb";
import { createMemberActionHandler } from "../../modules/iam/members/actions";
import { createIamManagementClient } from "../../server/iam/management-client";

const organizationId = "94944258-f6a2-4813-bd2e-3e4a38053021";
const memberId = "a237ca85-0634-4ce8-bd37-6d7bd90beaa8";
const requestId = "8deecb20-8d72-4b7e-a719-722a2e606728";

describe("IAM last-owner preservation", () => {
  it("WEB-SEC-OWNER-001 preserves concurrent provider rejection for demote suspend and remove", async () => {
    const operations: string[] = [];
    const transport = createRouterTransport((router) => {
      router.service(IamOrganizationService, {
        changeMemberRole: () => reject("change-role"),
        suspendMember: () => reject("suspend"),
        removeMember: () => reject("remove"),
      });
    });
    const handle = createMemberActionHandler({
      loadClient: async () => createIamManagementClient(transport),
      revalidatePath: () => undefined,
    });

    for (const [index, operation] of (["change-role", "suspend", "remove"] as const).entries()) {
      const identity = {
        organizationId,
        memberId,
        requestId,
        commandId: [
          "df486566-7614-461f-a72c-1b3d4ea9e985",
          "0dbc85ab-70fb-4362-8854-e4834be725ec",
          "e0e3e8fc-b867-45e3-bcc9-4942c1a51985",
        ][index],
        reason: "Owner rotation",
        expectedVersion: "9",
      };
      const result = operation === "change-role"
        ? await handle({ ...identity, operation, roleKey: "member" })
        : await handle({ ...identity, operation });
      expect(result).toMatchObject({ status: "error", kind: "last_owner", requestId });
    }

    expect(operations).toEqual(["change-role", "suspend", "remove"]);

    function reject(operation: string): never {
      operations.push(operation);
      const detail = create(ErrorDetailSchema, { reason: "last_owner", requestId, field: "member_id" });
      throw new ConnectError("concurrent owner changed", Code.FailedPrecondition, undefined, [
        { desc: ErrorDetailSchema, value: detail },
      ]);
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  createCommandIdentity,
  parseCommandContext,
  recoverCommandIdentity,
} from "../../server/commands/identity";

const firstId = "8deecb20-8d72-4b7e-a719-722a2e606728";
const secondId = "bce7762a-f7c7-4d22-8031-4336803038eb";
const thirdId = "94944258-f6a2-4813-bd2e-3e4a38053021";

describe("stable IAM command identity", () => {
  it("WEB-UNIT-COMMAND-001 keeps one command ID while recovery gets a fresh request ID", () => {
    const ids = [firstId, secondId, thirdId];
    const identity = createCommandIdentity(() => ids.shift() ?? thirdId);
    const recovered = recoverCommandIdentity(identity, () => ids.shift() ?? thirdId);

    expect(identity).toEqual({ requestId: firstId, commandId: secondId });
    expect(recovered).toEqual({ requestId: thirdId, commandId: secondId });
  });

  it("WEB-UNIT-COMMAND-001 validates and normalizes command context without changing identity", () => {
    expect(parseCommandContext({
      requestId: firstId,
      commandId: secondId,
      reason: "  Security review  ",
      expectedVersion: "42",
    })).toEqual({
      requestId: firstId,
      commandId: secondId,
      reason: "Security review",
      expectedVersion: BigInt(42),
    });

    expect(() => parseCommandContext({
      requestId: "invalid",
      commandId: secondId,
      reason: "Security review",
    })).toThrow("invalid command context");
    expect(() => parseCommandContext({
      requestId: firstId,
      commandId: secondId,
      reason: "   ",
    })).toThrow("invalid command context");
  });
});

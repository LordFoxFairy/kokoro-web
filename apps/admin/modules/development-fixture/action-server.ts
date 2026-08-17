"use server";

import { loadAdminConfig } from "../../server/config/config";
import { createIamDevelopmentFixtureClient } from "../../server/iam/development-fixture-client";
import { createWorkloadTransport } from "../../server/iam/transport";
import { createDevelopmentFixtureActionHandler } from "./actions";
import type { DevelopmentFixtureInput, DevelopmentFixtureResult } from "./schema";

export async function executeDevelopmentFixtureAction(input: DevelopmentFixtureInput): Promise<DevelopmentFixtureResult> {
  const mode = process.env.NODE_ENV ?? "development";
  if (mode === "production") return Object.freeze({ status: "error", operation: input.operation, kind: "disabled" });
  const config = loadAdminConfig();
  return createDevelopmentFixtureActionHandler({
    mode: config.mode,
    loadClient: async () => createIamDevelopmentFixtureClient(createWorkloadTransport(config.iam)),
  })(input);
}

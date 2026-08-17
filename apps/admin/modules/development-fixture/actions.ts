import "server-only";

import { toIamWebError } from "../../server/iam/error";
import type { IamDevelopmentFixtureClient } from "../../server/iam/development-fixture-client";
import { developmentFixtureInputSchema, type DevelopmentFixtureInput, type DevelopmentFixtureResult } from "./schema";

export function createDevelopmentFixtureActionHandler(dependencies: Readonly<{
  mode: "development" | "test" | "production";
  loadClient(): Promise<IamDevelopmentFixtureClient>;
}>) {
  return async function handle(input: DevelopmentFixtureInput): Promise<DevelopmentFixtureResult> {
    const operation = input.operation === "bootstrap" ? "bootstrap" : "reset";
    if (dependencies.mode === "production") return Object.freeze({ status: "error", operation, kind: "disabled" });
    const parsed = developmentFixtureInputSchema.safeParse(input);
    if (!parsed.success) return Object.freeze({ status: "error", operation, kind: "invalid" });
    try {
      const client = await dependencies.loadClient();
      const result = parsed.data.operation === "bootstrap" ? await client.bootstrap(parsed.data) : await client.resetPassword(parsed.data);
      return Object.freeze({ status: "success", operation: parsed.data.operation, email: result.email, outcome: result.status });
    } catch (error) {
      const kind = toIamWebError(error).kind;
      return Object.freeze({ status: "error", operation: parsed.data.operation, kind: kind === "invalid" ? "invalid" : "unavailable" });
    }
  };
}

import "server-only";

import { createClient, type Transport } from "@connectrpc/connect";

import { IamDevelopmentFixtureService } from "../../generated/iam/proto/kokoro/iam/v1/development_fixture_pb";

export type IamDevelopmentFixtureClient = Readonly<{
  bootstrap(input: Readonly<{ requestId: string; userId: string; email: string; name: string; password: string }>): Promise<Readonly<{ status: "CREATED" | "EXISTS"; email: string }>>;
  resetPassword(input: Readonly<{ requestId: string; email: string; password: string }>): Promise<Readonly<{ status: "RESET"; email: string }>>;
}>;

export function createIamDevelopmentFixtureClient(transport: Transport): IamDevelopmentFixtureClient {
  const client = createClient(IamDevelopmentFixtureService, transport);
  return Object.freeze({
    async bootstrap(input) {
      const response = await client.bootstrapDevelopmentAdministrator(input);
      if ((response.status !== "CREATED" && response.status !== "EXISTS") || response.email.length < 1) throw new Error("invalid IAM development fixture response");
      return Object.freeze({ status: response.status, email: response.email });
    },
    async resetPassword(input) {
      const response = await client.resetDevelopmentAdministratorPassword(input);
      if (response.status !== "RESET" || response.email.length < 1) throw new Error("invalid IAM development fixture response");
      return Object.freeze({ status: "RESET", email: response.email });
    },
  });
}

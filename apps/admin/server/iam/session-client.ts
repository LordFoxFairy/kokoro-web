import "server-only";

import { randomUUID } from "node:crypto";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { createClient, type Transport } from "@connectrpc/connect";

import { IamSessionService } from "../../generated/iam/proto/kokoro/iam/v1/session_pb";

export interface IamSessionClient {
  issueAccessToken(
    sessionToken: string,
    organizationId?: string,
  ): Promise<Readonly<{ accessToken: string; expiresAt: Date }>>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sessionTokenPattern = /^[A-Za-z0-9._~-]{32,1024}$/u;
const accessTokenPattern = /^[A-Za-z0-9._~-]{1,4096}$/u;

function invalid(): never {
  throw new Error("invalid IAM IssueAccessTokenResponse");
}

export function createIamSessionClient(transport: Transport): IamSessionClient {
  const rpc = createClient(IamSessionService, transport);
  const client: IamSessionClient = {
    async issueAccessToken(sessionToken, organizationId) {
      if (!sessionTokenPattern.test(sessionToken) || (organizationId !== undefined && !uuidPattern.test(organizationId))) {
        return invalid();
      }
      const response = await rpc.issueAccessToken({
        requestId: randomUUID(),
        sessionToken,
        organizationId,
      });
      if (!accessTokenPattern.test(response.accessToken) || response.expiresAt === undefined) return invalid();
      try {
        const expiresAt = timestampDate(response.expiresAt);
        if (!Number.isFinite(expiresAt.getTime())) return invalid();
        return Object.freeze({ accessToken: response.accessToken, expiresAt });
      } catch {
        return invalid();
      }
    },
  };
  return Object.freeze(client);
}

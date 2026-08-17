import "server-only";

import { randomUUID } from "node:crypto";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { createClient, type Transport } from "@connectrpc/connect";

import { IamCredentialService } from "../../generated/iam/proto/kokoro/iam/v1/credential_pb";

export type AdministratorLogin = Readonly<{
  user: Readonly<{ id: string; email: string; name: string }>;
  session: Readonly<{ token: string; expires: Date }>;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const tokenPattern = /^[A-Za-z0-9._~-]{32,1024}$/u;

function invalid(): never {
  throw new Error("invalid IAM credential response");
}

export function createIamCredentialClient(transport: Transport) {
  const rpc = createClient(IamCredentialService, transport);
  return Object.freeze({
    async login(email: string, password: string): Promise<AdministratorLogin> {
      const response = await rpc.loginAdministrator({ requestId: randomUUID(), email, password });
      const user = response.user;
      const session = response.session;
      if (
        user === undefined || session === undefined || !uuidPattern.test(user.id)
        || !uuidPattern.test(session.id) || session.userId !== user.id
        || user.platformRole !== "admin" || user.status !== "active"
        || !tokenPattern.test(session.sessionToken) || session.expires === undefined
      ) return invalid();
      let expires: Date;
      try {
        expires = timestampDate(session.expires);
      } catch {
        return invalid();
      }
      if (!Number.isFinite(expires.getTime())) return invalid();
      return Object.freeze({
        user: Object.freeze({ id: user.id, email: user.email, name: user.name }),
        session: Object.freeze({ token: session.sessionToken, expires }),
      });
    },
  });
}

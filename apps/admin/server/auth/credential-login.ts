import "server-only";

import { z } from "zod";

import type { AdministratorLogin } from "../iam/credential-client";
import { toIamWebError } from "../iam/error";

const inputSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
}).strict();

export type CredentialLoginResult =
  | Readonly<{ status: "success"; login: AdministratorLogin }>
  | Readonly<{ status: "invalid" | "invalid_credentials" | "unavailable" }>;

export async function authenticateAdministrator(
  input: unknown,
  client: Readonly<{ login(email: string, password: string): Promise<AdministratorLogin> }>,
): Promise<CredentialLoginResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return Object.freeze({ status: "invalid" });
  try {
    return Object.freeze({ status: "success", login: await client.login(parsed.data.email, parsed.data.password) });
  } catch (error) {
    const mapped = toIamWebError(error);
    return Object.freeze({ status: mapped.kind === "unauthenticated" ? "invalid_credentials" : "unavailable" });
  }
}

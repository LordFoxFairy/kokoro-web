import { z } from "zod";

import { safeMailEvidence } from "./evidence";

const addressSchema = z.object({
  Address: z.string().email(),
}).passthrough();

const messageSummarySchema = z.object({
  ID: z.string().min(1),
  Created: z.string().datetime({ offset: true }),
  To: z.array(addressSchema),
}).passthrough();

const searchResponseSchema = z.object({
  messages: z.array(messageSummarySchema),
}).passthrough();

const messageDetailSchema = z.object({
  ID: z.string().min(1),
  Created: z.string().datetime({ offset: true }),
  Text: z.string(),
  HTML: z.string(),
}).passthrough();

export type MagicLink = Readonly<{
  callbackUrl: string;
  evidence: ReturnType<typeof safeMailEvidence>;
}>;

export function extractMagicLink(raw: unknown, expectedOrigin: string): MagicLink {
  const message = messageDetailSchema.parse(raw);
  const origin = new URL(expectedOrigin).origin;
  for (const token of message.Text.split(/\s+/u)) {
    const candidate = token.replace(/^[<(]+|[)>.,]+$/gu, "");
    if (!URL.canParse(candidate)) continue;
    const url = new URL(candidate);
    if (url.origin !== origin || url.pathname !== "/api/auth/callback/nodemailer") continue;
    if (!url.searchParams.has("token") || !url.searchParams.has("email")) continue;
    return Object.freeze({
      callbackUrl: url.toString(),
      evidence: safeMailEvidence(message.ID, message.Created, url.toString()),
    });
  }
  throw new Error("captured message has no valid Auth.js callback");
}

export async function waitForMagicLink(input: Readonly<{
  apiBaseUrl: string;
  expectedWebOrigin: string;
  recipient: string;
  createdAfterEpochMs: number;
  timeoutMs?: number;
}>): Promise<MagicLink> {
  const deadline = Date.now() + (input.timeoutMs ?? 20_000);
  const searchUrl = new URL("/api/v1/search", input.apiBaseUrl);
  searchUrl.searchParams.set("query", `to:${input.recipient}`);
  while (Date.now() < deadline) {
    const response = await fetch(searchUrl);
    if (response.ok) {
      const search = searchResponseSchema.parse(await response.json() as unknown);
      const message = search.messages
        .filter((entry) => entry.To.some((address) => address.Address === input.recipient))
        .filter((entry) => Date.parse(entry.Created) >= input.createdAfterEpochMs)
        .sort((left, right) => Date.parse(right.Created) - Date.parse(left.Created))[0];
      if (message !== undefined) {
        const detail = await fetch(new URL(`/api/v1/message/${encodeURIComponent(message.ID)}`, input.apiBaseUrl));
        if (!detail.ok) throw new Error(`captured message read failed: ${String(detail.status)}`);
        return extractMagicLink(await detail.json() as unknown, input.expectedWebOrigin);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Magic Link email did not arrive before deadline");
}

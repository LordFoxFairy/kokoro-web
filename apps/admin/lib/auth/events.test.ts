import { describe, expect, it, vi } from "vitest";

import type { AdminAuthClient } from "@/lib/auth/client";
import { logAuthEvent } from "@/lib/auth/events";

describe("logAuthEvent", () => {
  it("preserves the existing best-effort policy when Platform rejects the audit write", async () => {
    const recordAuthEvent = vi.fn().mockRejectedValue(new Error("platform unavailable"));
    const client = { recordAuthEvent } as unknown as AdminAuthClient;
    const event = { email: "admin@kokoro.local", event: "signin" as const };

    await expect(logAuthEvent(client, event)).resolves.toBeUndefined();
    expect(recordAuthEvent).toHaveBeenCalledWith(event);
  });
});

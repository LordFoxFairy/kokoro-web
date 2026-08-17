import nodemailer from "nodemailer";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

import { startLocalMailbox } from "./local-mailbox";
import { waitForMagicLink } from "./mailbox-client";

describe("local pair SMTP mailbox", () => {
  it("IAM-E2E-AUTHEMAIL-001 captures and parses a real Nodemailer Magic Link locally", async () => {
    const mailbox = await startLocalMailbox();
    const callbackUrl = "http://127.0.0.1:3100/api/auth/callback/nodemailer?token=test-token&email=admin%40example.test";
    try {
      const transport = nodemailer.createTransport({
        host: "127.0.0.1",
        port: mailbox.smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
      });
      const createdAfterEpochMs = Date.now();
      await transport.sendMail({
        from: "noreply@example.test",
        to: "admin@example.test",
        subject: "Sign in",
        text: `Use this link once:\n\n${callbackUrl}`,
        html: `<p><a href="${callbackUrl}">Sign in</a></p>`,
      });

      const link = await waitForMagicLink({
        apiBaseUrl: mailbox.apiBaseUrl,
        expectedWebOrigin: "http://127.0.0.1:3100",
        recipient: "admin@example.test",
        createdAfterEpochMs,
      });
      expect(link.callbackUrl).toBe(callbackUrl);
      expect(JSON.stringify(link.evidence)).not.toContain("test-token");
    } finally {
      const ports = [mailbox.smtpPort, mailbox.apiPort];
      await mailbox.close();
      for (const port of ports) {
        const listener = createServer();
        await new Promise<void>((resolve, reject) => {
          listener.once("error", reject);
          listener.listen(port, "127.0.0.1", resolve);
        });
        await new Promise<void>((resolve, reject) => listener.close((error) => error === undefined ? resolve() : reject(error)));
      }
    }
  });
});

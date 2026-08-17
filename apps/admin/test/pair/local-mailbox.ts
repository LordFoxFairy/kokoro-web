import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { simpleParser } from "mailparser";
import { SMTPServer, type SMTPServerDataStream, type SMTPServerSession } from "smtp-server";

type CapturedMessage = Readonly<{
  ID: string;
  Created: string;
  To: readonly Readonly<{ Address: string }>[];
  Text: string;
  HTML: string;
}>;

export type LocalMailbox = Readonly<{
  smtpPort: number;
  apiPort: number;
  apiBaseUrl: string;
  close(): Promise<void>;
}>;

export async function startLocalMailbox(): Promise<LocalMailbox> {
  const messages: CapturedMessage[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    hideSTARTTLS: true,
    size: 2 * 1024 * 1024,
    onData(stream, session, callback) {
      capture(stream, session).then((message) => {
        messages.unshift(message);
        if (messages.length > 100) messages.length = 100;
        callback();
      }, (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))));
    },
  });
  const api = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET") return json(response, 405, { error: "method_not_allowed" });
    if (url.pathname === "/api/v1/messages") return json(response, 200, { messages: [] });
    if (url.pathname === "/api/v1/search") {
      const recipient = url.searchParams.get("query")?.replace(/^to:/u, "") ?? "";
      return json(response, 200, {
        messages: messages
          .filter((message) => message.To.some((address) => address.Address === recipient))
          .map(({ ID, Created, To }) => ({ ID, Created, To })),
      });
    }
    const id = /^\/api\/v1\/message\/([^/]+)$/u.exec(url.pathname)?.[1];
    if (id !== undefined) {
      const message = messages.find((entry) => entry.ID === decodeURIComponent(id));
      return message === undefined ? json(response, 404, { error: "not_found" }) : json(response, 200, message);
    }
    return json(response, 404, { error: "not_found" });
  });
  try {
    await Promise.all([listenSmtp(smtp), listenHttp(api)]);
  } catch (error) {
    smtp.close();
    api.close();
    throw error;
  }
  const smtpPort = port(smtp.server.address());
  const apiPort = port(api.address());
  return Object.freeze({
    smtpPort,
    apiPort,
    apiBaseUrl: `http://127.0.0.1:${String(apiPort)}`,
    async close() {
      await Promise.all([closeSmtp(smtp), closeHttp(api)]);
    },
  });
}

async function capture(stream: SMTPServerDataStream, session: SMTPServerSession): Promise<CapturedMessage> {
  const parsed = await simpleParser(stream, { skipImageLinks: true });
  return Object.freeze({
    ID: randomUUID(),
    Created: new Date().toISOString(),
    To: Object.freeze(session.envelope.rcptTo.map(({ address }) => Object.freeze({ Address: address.toLowerCase() }))),
    Text: parsed.text ?? "",
    HTML: typeof parsed.html === "string" ? parsed.html : "",
  });
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function port(address: string | AddressInfo | null): number {
  if (address === null || typeof address === "string") throw new Error("local mailbox listener has no TCP port");
  return address.port;
}

function listenSmtp(server: SMTPServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function listenHttp(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeSmtp(server: SMTPServer): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

function closeHttp(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

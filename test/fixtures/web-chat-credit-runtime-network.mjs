import { execFile } from "node:child_process";
import { chmod, cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAXIMUM_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024;

function commandEnvironment(source) {
  const output = {};
  for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"]) {
    if (typeof source[name] === "string" && source[name].length > 0) output[name] = source[name];
  }
  return { ...output, CI: "1", NEXT_TELEMETRY_DISABLED: "1" };
}

async function openssl(args, cwd) {
  return execFileAsync("openssl", args, {
    cwd,
    env: commandEnvironment(process.env),
    maxBuffer: MAXIMUM_CHILD_OUTPUT_BYTES,
  });
}

export async function generatePublicTls(privateRoot, candidateHost) {
  const directory = join(privateRoot, "public-tls");
  await mkdir(directory, { mode: 0o700 });
  const authorityConfig = join(directory, "authority.cnf");
  const serverConfig = join(directory, "server.cnf");
  const authorityKey = join(directory, "authority.key");
  const authorityFile = join(directory, "authority.pem");
  const serverKeyFile = join(directory, "server.key");
  const serverRequest = join(directory, "server.csr");
  const serverCertificateFile = join(directory, "server.pem");
  await writeFile(authorityConfig, [
    "[req]",
    "prompt = no",
    "distinguished_name = subject",
    "x509_extensions = authority",
    "[subject]",
    "CN = Kokoro Web Runtime Fixture CA",
    "[authority]",
    "basicConstraints = critical,CA:true,pathlen:0",
    "keyUsage = critical,keyCertSign,cRLSign",
    "subjectKeyIdentifier = hash",
    "authorityKeyIdentifier = keyid:always",
    "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(serverConfig, [
    "[req]",
    "prompt = no",
    "distinguished_name = subject",
    "req_extensions = server",
    "[subject]",
    `CN = ${candidateHost}`,
    "[server]",
    "basicConstraints = critical,CA:false",
    "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @names",
    "[names]",
    `DNS.1 = ${candidateHost}`,
    "",
  ].join("\n"), { mode: 0o600 });
  await openssl([
    "req", "-new", "-newkey", "rsa:2048", "-nodes", "-x509", "-sha256", "-days", "1",
    "-config", authorityConfig, "-keyout", authorityKey, "-out", authorityFile,
  ], directory);
  await openssl([
    "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-config", serverConfig,
    "-keyout", serverKeyFile, "-out", serverRequest,
  ], directory);
  await openssl([
    "x509", "-req", "-sha256", "-days", "1", "-in", serverRequest,
    "-CA", authorityFile, "-CAkey", authorityKey, "-CAcreateserial",
    "-extfile", serverConfig, "-extensions", "server", "-out", serverCertificateFile,
  ], directory);
  await Promise.all([
    chmod(authorityFile, 0o600),
    chmod(serverCertificateFile, 0o600),
    chmod(serverKeyFile, 0o600),
  ]);
  await Promise.all([
    rm(authorityConfig, { force: true }),
    rm(serverConfig, { force: true }),
    rm(authorityKey, { force: true }),
    rm(serverRequest, { force: true }),
    rm(join(directory, "authority.srl"), { force: true }),
  ]);
  return Object.freeze({
    publicCertificateAuthorityFile: authorityFile,
    publicTlsCertificateFile: serverCertificateFile,
    publicTlsKeyFile: serverKeyFile,
  });
}

export async function prepareStandaloneCandidate(candidateDirectory) {
  const standaloneDirectory = join(candidateDirectory, ".next", "standalone");
  const server = await lstat(join(standaloneDirectory, "server.js")).catch(() => null);
  if (server === null || !server.isFile() || server.isSymbolicLink()) {
    throw new Error("WEB_FIXTURE_CANDIDATE_BUILD_INVALID");
  }
  const source = join(candidateDirectory, ".next", "static");
  const metadata = await lstat(source).catch(() => null);
  if (metadata === null || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("WEB_FIXTURE_CANDIDATE_BUILD_INVALID");
  }
  await mkdir(join(standaloneDirectory, ".next"), { recursive: true, mode: 0o700 });
  await cp(source, join(standaloneDirectory, ".next", "static"), { recursive: true, force: true });
  const publicDirectory = join(candidateDirectory, "public");
  const publicMetadata = await lstat(publicDirectory).catch(() => null);
  if (publicMetadata?.isDirectory() && !publicMetadata.isSymbolicLink()) {
    await cp(publicDirectory, join(standaloneDirectory, "public"), { recursive: true, force: true });
  }
  return standaloneDirectory;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
]);

function proxyHeaders(headers) {
  const output = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) &&
        name.toLowerCase() !== "x-forwarded-for" && name.toLowerCase() !== "x-forwarded-host" &&
        name.toLowerCase() !== "x-forwarded-proto") output[name] = value;
  }
  output["x-forwarded-for"] = "127.0.0.1";
  output["x-forwarded-host"] = headers.host;
  output["x-forwarded-proto"] = "https";
  return output;
}

export async function startStrictPublicProxy(input) {
  const origin = new URL(input.publicOrigin);
  if (
    origin.protocol !== "https:" || origin.hostname !== input.candidateHost || origin.port === "" ||
    origin.origin !== input.publicOrigin || !Number.isSafeInteger(input.upstreamPort) ||
    input.upstreamPort < 1 || input.upstreamPort > 65_535
  ) throw new Error("WEB_FIXTURE_PUBLIC_PROXY_INVALID");
  const [certificate, privateKey] = await Promise.all([
    readFile(input.certificateFile),
    readFile(input.privateKeyFile),
  ]);
  const expectedHost = origin.host;
  const server = createHttpsServer({ cert: certificate, key: privateKey, minVersion: "TLSv1.3" }, (request, response) => {
    if (request.headers.host !== expectedHost || request.url === undefined || !request.url.startsWith("/") || request.url.startsWith("//")) {
      response.writeHead(421, { "content-length": "0", "cache-control": "no-store" });
      response.end();
      return;
    }
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: input.upstreamPort,
      method: request.method,
      path: request.url,
      headers: proxyHeaders(request.headers),
    }, (upstreamResponse) => {
      const headers = proxyHeaders(upstreamResponse.headers);
      delete headers["x-forwarded-for"];
      delete headers["x-forwarded-host"];
      delete headers["x-forwarded-proto"];
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
    });
    upstream.once("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-length": "0", "cache-control": "no-store" });
      response.end();
    });
    request.once("error", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(Number(origin.port), "127.0.0.1", resolvePromise);
  });
  return Object.freeze({
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
  });
}

export async function availableLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
  if (address === null || typeof address === "string") throw new Error("WEB_FIXTURE_INTERNAL_PORT_INVALID");
  return address.port;
}

export async function waitForCandidateProcess(child, port, expectedHost) {
  const deadline = Date.now() + 30_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("WEB_FIXTURE_CANDIDATE_NOT_READY");
    const status = await new Promise((resolvePromise) => {
      const request = httpRequest({
        hostname: "127.0.0.1", port, path: "/api/health/live", method: "GET",
        headers: { host: expectedHost }, timeout: 1_000,
      }, (response) => {
        response.resume();
        response.once("end", () => resolvePromise(response.statusCode ?? 0));
      });
      request.once("timeout", () => request.destroy());
      request.once("error", () => resolvePromise(0));
      request.end();
    });
    if (status === 204) return;
    if (process.env.KOKORO_COMPAT_DEBUG === "1" && status !== 0 && status !== lastStatus) {
      process.stderr.write(`WEB_FIXTURE_CANDIDATE_HEALTH_STATUS=${status}\n`);
    }
    lastStatus = status;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("WEB_FIXTURE_CANDIDATE_NOT_READY");
}

function nodeResponseHeaders(headers) {
  const output = new Headers();
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) for (const value of raw) output.append(name, value);
    else output.set(name, raw);
  }
  return output;
}

function createCookieJar() {
  const cookies = new Map();
  return Object.freeze({
    header() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    store(setCookieHeaders) {
      for (const header of setCookieHeaders ?? []) {
        const segments = header.split(";");
        const separator = segments[0]?.indexOf("=") ?? -1;
        if (separator < 1) throw new Error("WEB_FIXTURE_COOKIE_INVALID");
        const name = segments[0].slice(0, separator).trim();
        const value = segments[0].slice(separator + 1).trim();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || /[\u0000-\u0020\u007f;,]/u.test(value)) {
          throw new Error("WEB_FIXTURE_COOKIE_INVALID");
        }
        const attributes = segments.slice(1).map((segment) => segment.trim().toLowerCase());
        if (value === "" || attributes.includes("max-age=0")) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
  });
}

async function readBoundedResponse(response, maximumBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const raw of response) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.byteLength;
    if (size > maximumBytes) {
      response.destroy();
      throw new Error("WEB_FIXTURE_BROWSER_RESPONSE_INVALID");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createBrowserHttpClient(state) {
  const origin = new URL(state.publicOrigin);
  const jar = createCookieJar();
  let authority;
  const authorityPromise = readFile(state.publicCertificateAuthorityFile).then((value) => {
    authority = value;
    return value;
  });
  const open = async (input) => {
    const ca = authority ?? await authorityPromise;
    const cookie = jar.header();
    const headers = {
      host: origin.host,
      ...input.headers,
      ...(cookie === "" ? {} : { cookie }),
    };
    if (input.body !== undefined) headers["content-length"] = String(Buffer.byteLength(input.body));
    return new Promise((resolvePromise, rejectPromise) => {
      const request = httpsRequest({
        hostname: "127.0.0.1",
        port: Number(origin.port),
        servername: state.candidateHost,
        ca,
        minVersion: "TLSv1.3",
        method: input.method ?? "GET",
        path: input.path,
        headers,
      }, (response) => {
        try {
          jar.store(response.headers["set-cookie"]);
          resolvePromise(response);
        } catch (error) {
          response.destroy();
          rejectPromise(error);
        }
      });
      request.once("error", rejectPromise);
      request.setTimeout(input.timeoutMs ?? 30_000, () => request.destroy(new Error("WEB_FIXTURE_BROWSER_TIMEOUT")));
      request.end(input.body);
    });
  };
  return Object.freeze({
    async request(input) {
      const response = await open(input);
      const body = await readBoundedResponse(response, input.maximumBytes);
      return Object.freeze({ status: response.statusCode ?? 0, headers: nodeResponseHeaders(response.headers), body });
    },
    async stream(input) {
      const response = await open(input);
      return Object.freeze({
        status: response.statusCode ?? 0,
        headers: nodeResponseHeaders(response.headers),
        body: Readable.toWeb(response),
      });
    },
  });
}

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type EvidenceTimestamp = Readonly<{
  utc: string;
  local: string;
  timezoneOffset: string;
  epochMs: number;
}>;

export type CommandEvidence = Readonly<{
  name: string;
  command: string;
  args: readonly string[];
  started: EvidenceTimestamp;
  finished: EvidenceTimestamp;
  durationMs: number;
  exitCode: number;
  stdoutPath: string;
  stderrPath: string;
}>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function timestamp(date = new Date()): EvidenceTimestamp {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const timezoneOffset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  const local = [
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}${timezoneOffset}`,
  ].join("T");
  return { utc: date.toISOString(), local, timezoneOffset, epochMs: date.getTime() };
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export async function writeJson(pathname: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(pathname));
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function sha256File(pathname: string): Promise<string> {
  return createHash("sha256").update(await readFile(pathname)).digest("hex");
}

export async function sha256Files(paths: readonly string[]): Promise<string> {
  const digest = createHash("sha256");
  for (const pathname of [...paths].sort()) {
    digest.update(pathname);
    digest.update("\0");
    digest.update(await readFile(pathname));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const pathname = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(pathname));
    else files.push(pathname);
  }
  return files.sort();
}

export async function runCommand(input: Readonly<{
  name: string;
  command: string;
  args: readonly string[];
  cwd: string;
  evidenceRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<CommandEvidence> {
  const logRoot = path.join(input.evidenceRoot, "commands");
  await ensureDirectory(logRoot);
  const stdoutPath = path.join(logRoot, `${input.name}.stdout.log`);
  const stderrPath = path.join(logRoot, `${input.name}.stderr.log`);
  const stdout = createWriteStream(stdoutPath, { flags: "wx", mode: 0o600 });
  const stderr = createWriteStream(stderrPath, { flags: "wx", mode: 0o600 });
  const started = timestamp();
  process.stdout.write(`[acceptance] ${input.name} started at ${started.utc}\n`);
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.environment ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.write(chunk);
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise<number>((resolve) => {
    child.once("error", () => resolve(-1));
    child.once("exit", (code) => resolve(code ?? -1));
  });
  await Promise.all([
    new Promise<void>((resolve) => stdout.end(resolve)),
    new Promise<void>((resolve) => stderr.end(resolve)),
  ]);
  const finished = timestamp();
  process.stdout.write(`[acceptance] ${input.name} finished with ${String(exitCode)} at ${finished.utc}\n`);
  return {
    name: input.name,
    command: input.command,
    args: input.args,
    started,
    finished,
    durationMs: finished.epochMs - started.epochMs,
    exitCode,
    stdoutPath: path.relative(input.evidenceRoot, stdoutPath),
    stderrPath: path.relative(input.evidenceRoot, stderrPath),
  };
}

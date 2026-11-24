import { experimental_spawnHostProcess as spawn } from "@get-bb/plugin-sdk/process";
import { constants } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { actionResultSchema, hostActionInputSchema } from "./vocabulary.js";

const OUTPUT_LIMIT = 80_000;
const CONTENT_LIMIT = OUTPUT_LIMIT - 100;
const TRUNCATED = "\n[Output limit reached]";
type Input = z.infer<typeof hostActionInputSchema>;
type Result = z.infer<typeof actionResultSchema>;

function aborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function checkedPath(
  root: string,
  relative: string,
  writing: boolean,
): Promise<string> {
  if (
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").includes("..")
  ) {
    throw new Error(
      "Action paths must be relative and must not contain parent traversal.",
    );
  }
  const target = path.resolve(root, relative);
  if (!within(root, target))
    throw new Error("Action path escapes the workspace.");
  const ancestor = await realpath(writing ? path.dirname(target) : target);
  if (!within(root, ancestor))
    throw new Error("Action path resolves outside the workspace.");
  return target;
}

async function regularFile(root: string, target: string) {
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("The action requires a regular file.");
    if (!within(root, await realpath(target)))
      throw new Error("The opened file escapes the workspace.");
    const current = await lstat(target);
    if (
      current.isSymbolicLink() ||
      current.dev !== info.dev ||
      current.ino !== info.ino
    )
      throw new Error("The file changed while opening it.");
    return { handle, info };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function writeFile(
  root: string,
  target: string,
  content: string,
  signal: AbortSignal,
): Promise<void> {
  const parent = path.dirname(target);
  const canonicalParent = await realpath(parent);
  const parentInfo = await stat(canonicalParent);
  if (!within(root, canonicalParent))
    throw new Error("Write parent escapes the workspace.");
  let mode = 0o600;
  let previous: { dev: number; ino: number } | null = null;
  try {
    const file = await regularFile(root, target);
    mode = file.info.mode & 0o777;
    previous = { dev: file.info.dev, ino: file.info.ino };
    await file.handle.close();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  aborted(signal);
  const temporary = path.join(canonicalParent, `.bb-web-${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    aborted(signal);
    const currentParent = await realpath(parent);
    const currentParentInfo = await stat(currentParent);
    if (
      currentParent !== canonicalParent ||
      currentParentInfo.dev !== parentInfo.dev ||
      currentParentInfo.ino !== parentInfo.ino ||
      !within(root, currentParent)
    )
      throw new Error("The write directory changed during the action.");
    let current = null;
    try {
      current = await lstat(target);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    if (
      current?.isSymbolicLink() ||
      (previous === null
        ? current !== null
        : current === null ||
          current.dev !== previous.dev ||
          current.ino !== previous.ino)
    )
      throw new Error("The write target changed during the action.");
    aborted(signal);
    await rename(temporary, target);
  } finally {
    await handle.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function command(
  cwd: string,
  text: string,
  id: string,
  signal: AbortSignal,
): Promise<Result> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(text, [], {
      cwd,
      shell: true,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stopping: string | null = null;
    let termination = Promise.resolve();
    const kill = (kind: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (grouped) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ESRCH")
        )
          reject(error);
      }
    };
    const stop = (reason: string) => {
      if (stopping !== null) return;
      stopping = reason;
      kill("SIGTERM");
      termination = new Promise<void>((done) => {
        setTimeout(() => {
          kill("SIGKILL");
          done();
        }, 1_000);
      });
    };
    const onAbort = () => stop("cancelled");
    const timer = setTimeout(
      () => stop("Command timed out after 30 seconds."),
      30_000,
    );
    const collect = (data: Buffer) => {
      const remaining = CONTENT_LIMIT - bytes;
      if (remaining > 0) {
        const part = data.subarray(0, remaining);
        chunks.push(part);
        bytes += part.length;
      }
      if (data.length > remaining) stop("Output limit reached");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode) => {
      void termination.then(() => {
        cleanup();
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const output = Buffer.concat(chunks).toString("utf8");
        resolve({
          id,
          output: output + (stopping === null ? "" : `\n[${stopping}]`),
          exitCode: stopping === null ? (exitCode ?? 1) : 1,
        });
      }, reject);
    });
  });
}

export async function executeWorkspaceAction(
  input: Input,
  signal: AbortSignal,
): Promise<Result> {
  const { cwd, action } = hostActionInputSchema.parse(input);
  aborted(signal);
  try {
    if (!path.isAbsolute(cwd))
      throw new Error("Workspace cwd must be absolute.");
    const root = await realpath(cwd);
    if (!(await stat(root)).isDirectory())
      throw new Error("Workspace cwd must be an existing directory.");
    aborted(signal);
    if (action.kind === "command") {
      if (process.platform === "win32")
        throw new Error(
          "Command actions are unsupported on Windows because process-tree cancellation is not verified. File actions remain available.",
        );
      return await command(root, action.command, action.id, signal);
    }
    const target = await checkedPath(
      root,
      action.path,
      action.kind === "write",
    );
    aborted(signal);
    if (action.kind === "write") {
      await writeFile(root, target, action.content, signal);
      return { id: action.id, output: `Wrote ${action.path}`, exitCode: 0 };
    }
    if (action.kind === "read") {
      const { handle } = await regularFile(root, target);
      try {
        const buffer = Buffer.alloc(CONTENT_LIMIT + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        aborted(signal);
        return {
          id: action.id,
          output:
            buffer
              .subarray(0, CONTENT_LIMIT)
              .subarray(0, bytesRead)
              .toString("utf8") + (bytesRead > CONTENT_LIMIT ? TRUNCATED : ""),
          exitCode: 0,
        };
      } finally {
        await handle.close();
      }
    }
    const entries: string[] = [];
    const directoryPath = await realpath(target);
    if (!within(root, directoryPath))
      throw new Error("Listing path escapes the workspace.");
    const directory = await opendir(directoryPath);
    try {
      if (!within(root, await realpath(target)))
        throw new Error("The listing directory changed during the action.");
    } catch (error) {
      await directory.close();
      throw error;
    }
    for await (const entry of directory) {
      aborted(signal);
      if (entries.length >= 200) {
        entries.push("[Listing limited to 200 entries]");
        break;
      }
      entries.push(entry.name + (entry.isDirectory() ? "/" : ""));
    }
    const listing = entries.join("\n");
    return {
      id: action.id,
      output:
        listing.slice(0, CONTENT_LIMIT) +
        (listing.length > CONTENT_LIMIT ? TRUNCATED : ""),
      exitCode: 0,
    };
  } catch (error) {
    aborted(signal);
    return {
      id: action.id,
      output: (error instanceof Error ? error.message : String(error)).slice(
        0,
        OUTPUT_LIMIT,
      ),
      exitCode: 1,
    };
  }
}

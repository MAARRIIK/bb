import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  stat,
  symlink,
  writeFile,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebAction } from "./vocabulary.js";
import { executeWorkspaceAction } from "./action-executor.js";

let sandbox = "";
let cwd = "";

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "bb-web-executor-"));
  cwd = path.join(sandbox, "workspace");
  await mkdir(cwd);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function execute(action: WebAction, signal = new AbortController().signal) {
  return executeWorkspaceAction({ cwd, action }, signal);
}

function nodeCommand(script: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
  return `${quote(process.execPath)} -e ${quote(script)}`;
}

describe("workspace file actions", () => {
  it("reads and lists files, then atomically replaces a file while preserving its mode", async () => {
    await writeFile(path.join(cwd, "script.sh"), "old");
    await chmod(path.join(cwd, "script.sh"), 0o751);
    expect(
      await execute({ id: "read", kind: "read", path: "script.sh" }),
    ).toEqual({ id: "read", output: "old", exitCode: 0 });
    expect(
      await execute({ id: "list", kind: "list", path: "." }),
    ).toMatchObject({ output: "script.sh", exitCode: 0 });
    expect(
      await execute({
        id: "write",
        kind: "write",
        path: "script.sh",
        content: "new content",
      }),
    ).toMatchObject({ exitCode: 0 });
    expect(await readFile(path.join(cwd, "script.sh"), "utf8")).toBe(
      "new content",
    );
    expect((await stat(path.join(cwd, "script.sh"))).mode & 0o777).toBe(0o751);
    expect(await readdir(cwd)).toEqual(["script.sh"]);
  });

  it("creates a file in an existing parent and refuses to create missing directories", async () => {
    await mkdir(path.join(cwd, "existing"));
    expect(
      await execute({
        id: "new",
        kind: "write",
        path: "existing/new.txt",
        content: "created",
      }),
    ).toMatchObject({ exitCode: 0 });
    expect(await readFile(path.join(cwd, "existing/new.txt"), "utf8")).toBe(
      "created",
    );
    expect(
      await execute({
        id: "missing",
        kind: "write",
        path: "missing/new.txt",
        content: "no",
      }),
    ).toMatchObject({ exitCode: 1 });
    expect(await readdir(cwd)).toEqual(["existing"]);
  });

  it.each([
    "../outside.txt",
    "/tmp/outside.txt",
    "C:\\outside.txt",
    "folder/../outside.txt",
  ])("refuses path escape %s without changing outside data", async (file) => {
    const outside = path.join(sandbox, "outside.txt");
    await writeFile(outside, "private");
    for (const action of [
      { id: "read", kind: "read", path: file },
      { id: "write", kind: "write", path: file, content: "changed" },
    ] satisfies WebAction[]) {
      expect(await execute(action)).toMatchObject({ exitCode: 1 });
    }
    expect(await readFile(outside, "utf8")).toBe("private");
  });

  it("refuses escaped directory symlinks for reads, listings and new writes", async () => {
    await mkdir(path.join(sandbox, "outside"));
    await writeFile(path.join(sandbox, "outside/secret"), "private");
    await symlink(
      path.join(sandbox, "outside"),
      path.join(cwd, "escape"),
      "dir",
    );
    expect(
      await execute({ id: "read", kind: "read", path: "escape/secret" }),
    ).toMatchObject({ exitCode: 1 });
    expect(
      await execute({ id: "list", kind: "list", path: "escape" }),
    ).toMatchObject({ exitCode: 1 });
    expect(
      await execute({
        id: "write",
        kind: "write",
        path: "escape/new",
        content: "changed",
      }),
    ).toMatchObject({ exitCode: 1 });
    expect(await readdir(path.join(sandbox, "outside"))).toEqual(["secret"]);
  });

  it("does not replace a file symlink, including a dangling symlink", async () => {
    await writeFile(path.join(cwd, "real"), "original");
    await symlink("real", path.join(cwd, "link"));
    await symlink("absent", path.join(cwd, "dangling"));
    for (const file of ["link", "dangling"]) {
      expect(
        await execute({
          id: "write",
          kind: "write",
          path: file,
          content: "changed",
        }),
      ).toMatchObject({ exitCode: 1 });
    }
    expect(await readFile(path.join(cwd, "real"), "utf8")).toBe("original");
    expect(await readdir(cwd)).toEqual(["dangling", "link", "real"]);
  });

  it("bounds large reads and directory listings", async () => {
    await writeFile(path.join(cwd, "large"), "x".repeat(200_000));
    const read = await execute({ id: "read", kind: "read", path: "large" });
    expect(read.exitCode).toBe(0);
    expect(read.output.length).toBeLessThanOrEqual(80_000);
    expect(read.output).toContain("Output limit reached");
    await Promise.all(
      Array.from({ length: 220 }, (_, index) =>
        writeFile(path.join(cwd, `file-${index}`), ""),
      ),
    );
    const listing = await execute({ id: "list", kind: "list", path: "." });
    expect(listing.output.split("\n")).toHaveLength(201);
    expect(listing.output).toContain("Listing limited to 200 entries");
  });

  it("rejects an already cancelled action before any file side effect", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      execute(
        { id: "write", kind: "write", path: "new", content: "no" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(cwd)).toEqual([]);
  });

  it("rejects relative and non-directory workspace roots", async () => {
    await writeFile(path.join(cwd, "file"), "data");
    for (const invalid of ["relative", path.join(cwd, "file")]) {
      expect(
        await executeWorkspaceAction(
          { cwd: invalid, action: { id: "list", kind: "list", path: "." } },
          new AbortController().signal,
        ),
      ).toMatchObject({ exitCode: 1 });
    }
  });
});

describe.skipIf(process.platform === "win32")("approved shell commands", () => {
  it("uses the workspace cwd and returns the real exit code and both output streams", async () => {
    const result = await execute({
      id: "command",
      kind: "command",
      command: nodeCommand(
        'process.stdout.write(process.cwd()); process.stderr.write("stderr-marker"); process.exitCode=7;',
      ),
    });
    expect(result.exitCode).toBe(7);
    expect(result.output).toContain(await realpath(cwd));
    expect(result.output).toContain("stderr-marker");
  });

  it("terminates a command when combined output exceeds the bound", async () => {
    const result = await execute({
      id: "command",
      kind: "command",
      command: nodeCommand(
        'process.on("SIGTERM", () => {}); process.stdout.write("x".repeat(200000)); setInterval(() => {}, 1000);',
      ),
    });
    expect(result.exitCode).toBe(1);
    expect(result.output.length).toBeLessThanOrEqual(80_000);
    expect(result.output).toContain("Output limit reached");
  });

  it("cancels a running command before its later filesystem effect", async () => {
    const controller = new AbortController();
    const execution = execute(
      {
        id: "command",
        kind: "command",
        command: nodeCommand(
          'require("node:fs").writeFileSync("started", "yes"); setTimeout(() => require("node:fs").writeFileSync("late", "no"), 2000);',
        ),
      },
      controller.signal,
    );
    const rejected = expect(execution).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(async () =>
      expect(await readFile(path.join(cwd, "started"), "utf8")).toBe("yes"),
    );
    controller.abort();
    await rejected;
    expect(await readdir(cwd)).toEqual(["started"]);
  });

  it("rejects an already cancelled command before spawning it", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      execute(
        {
          id: "command",
          kind: "command",
          command: nodeCommand(
            'require("node:fs").writeFileSync("unexpected", "no")',
          ),
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(cwd)).toEqual([]);
  });
});

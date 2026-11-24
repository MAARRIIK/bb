import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const desktopPackageRoot = process.cwd();

const printedConfigSchema = z
  .object({
    extraMetadata: z.object({
      desktopName: z.string(),
      name: z.string(),
    }),
    nsis: z.object({ oneClick: z.boolean(), perMachine: z.boolean() }),
    win: z.object({
      icon: z.string(),
      target: z.array(
        z.object({ arch: z.array(z.string()), target: z.string() }),
      ),
    }),
  })
  .passthrough();

async function printConfig(args: string[], channel: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/run-electron-builder.mjs", ...args, "--print-config"],
    {
      cwd: desktopPackageRoot,
      env: {
        BB_DESKTOP_RELEASE_CHANNEL: channel,
        PATH: process.env.PATH,
      },
    },
  );
  return printedConfigSchema.parse(JSON.parse(stdout));
}

describe("electron-builder Windows config", () => {
  it("builds a per-user x64 NSIS installer named after the product", async () => {
    const config = await printConfig(["--win", "--x64"], "latest");

    expect(config.win.target).toEqual([{ arch: ["x64"], target: "nsis" }]);
    expect(config.win.icon).toBe("assets/icon.png");
    expect(config.nsis).toEqual({ oneClick: true, perMachine: false });
    expect(config.extraMetadata).toEqual({
      desktopName: "dev.maarriik.ai.desktop",
      name: "ai-ide",
    });
  });

  it("keeps the nightly install apart from the stable one", async () => {
    const config = await printConfig(["--win", "--x64"], "nightly");

    expect(config.win.icon).toBe("assets/icon-nightly.png");
    expect(config.extraMetadata).toEqual({
      desktopName: "dev.maarriik.ai.nightly.desktop",
      name: "ai-ide-nightly",
    });
  });

  it("uses AI metadata for Linux and the desktop identity for macOS", async () => {
    const linux = await printConfig(["--linux", "--x64"], "latest");
    const mac = await printConfig(["--mac", "--arm64"], "latest");

    expect(linux.extraMetadata).toEqual({
      desktopName: "dev.maarriik.ai.desktop",
      name: "ai-ide",
    });
    expect(mac.extraMetadata).toEqual({
      desktopName: "dev.maarriik.ai.desktop",
      name: "ai-ide",
    });
  });
});

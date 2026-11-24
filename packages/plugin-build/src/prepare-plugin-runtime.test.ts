import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPluginRuntime } from "./prepare-plugin-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  themes: {
    id: string;
    name: string;
    css: string;
    codeTheme?: { dark?: string; light?: string };
  }[],
  files: Record<string, string>,
) {
  const root = await mkdtemp(join(tmpdir(), "bb-plugin-runtime-"));
  roots.push(root);
  const sourceRoot = join(root, "source");
  const targetDir = join(root, "runtime");
  await mkdir(sourceRoot);
  await writeFile(
    join(sourceRoot, "package.json"),
    JSON.stringify({
      name: "bb-plugin-runtime-fixture",
      version: "1.0.0",
      bb: {
        name: "Runtime fixture",
        description: "Theme runtime assets",
        branding: { icon: "./assets/icon.svg" },
        server: "./server.ts",
        app: "./app.tsx",
        themes,
      },
    }),
  );
  for (const [entry, contents] of Object.entries({
    "assets/icon.svg": "<svg/>",
    ...files,
  })) {
    await mkdir(dirname(join(sourceRoot, entry)), { recursive: true });
    await writeFile(join(sourceRoot, entry), contents);
  }
  return { root, sourceRoot, targetDir };
}

describe("copyPluginRuntime", () => {
  it("retains declared theme files and attribution without copying unrelated source", async () => {
    const themes = [
      {
        id: "builtin",
        name: "Builtin",
        css: "./theme.css",
        codeTheme: { dark: "catppuccin-mocha", light: "catppuccin-latte" },
      },
      {
        id: "custom",
        name: "Custom",
        css: "./themes/custom.css",
        codeTheme: { dark: "./themes/dark.json", light: "./themes/light.json" },
      },
    ];
    const shippedFiles = {
      "dist/server.js": "export default () => {};",
      "dist/app.js": "export default {};",
      "skills/fixture/SKILL.md": "Fixture skill",
      "theme.css": ":root { --canvas: red; }",
      "themes/custom.css": ":root { --ink: blue; }",
      "themes/dark.json": '{"name":"Custom dark"}',
      "themes/light.json": '{"name":"Custom light"}',
      LICENSE: "Plugin license",
      "NOTICE.txt": "Third-party notice",
      "SOURCE.md": "Pinned source provenance",
      "icon-sets/licenses/lucide.txt": "Icon license",
    };
    const { sourceRoot, targetDir } = await fixture(themes, {
      ...shippedFiles,
      "server.ts": "Unbundled source",
      "node_modules/unused/index.js": "Unused dependency",
    });
    await copyPluginRuntime({ sourceRoot, targetDir });
    for (const [entry, contents] of Object.entries(shippedFiles)) {
      expect(await readFile(join(targetDir, entry), "utf8")).toBe(contents);
    }
    expect(await readFile(join(targetDir, "assets/icon.svg"), "utf8")).toBe(
      "<svg/>",
    );
    expect(
      JSON.parse(await readFile(join(targetDir, "package.json"), "utf8")),
    ).toMatchObject({
      bb: { server: "./dist/server.js", app: "./dist/app.js", themes },
    });
    const runtimeEntries = await readdir(targetDir);
    expect(runtimeEntries).not.toContain("server.ts");
    expect(runtimeEntries).not.toContain("node_modules");
  });

  it.each(["css", "codeTheme"])(
    "rejects a declared %s path outside the plugin",
    async (kind) => {
      const theme =
        kind === "css"
          ? { id: "escape", name: "Escape", css: "../outside.css" }
          : {
              id: "escape",
              name: "Escape",
              css: "./theme.css",
              codeTheme: { dark: "../outside.json" },
            };
      const { root, sourceRoot, targetDir } = await fixture([theme], {
        "theme.css": ":root {}",
      });
      await writeFile(join(root, "outside.css"), "outside CSS");
      await writeFile(join(root, "outside.json"), '{"name":"Outside"}');
      await expect(
        copyPluginRuntime({ sourceRoot, targetDir }),
      ).rejects.toThrow(/escapes the plugin directory/);
      expect(await readFile(join(root, "outside.css"), "utf8")).toBe(
        "outside CSS",
      );
    },
  );

  it.each(["themes/custom.css", "icon-sets/licenses/third-party.txt"])(
    "rejects an escaping symlink in %s",
    async (entry) => {
      const { root, sourceRoot, targetDir } = await fixture(
        [{ id: "custom", name: "Custom", css: "./themes/custom.css" }],
        {},
      );
      const outside = join(root, "outside.txt");
      await writeFile(outside, "outside bytes");
      await mkdir(dirname(join(sourceRoot, entry)), { recursive: true });
      await symlink(outside, join(sourceRoot, entry));
      await expect(
        copyPluginRuntime({ sourceRoot, targetDir }),
      ).rejects.toThrow(/escapes the plugin directory through a symlink/);
      expect(await readFile(outside, "utf8")).toBe("outside bytes");
    },
  );
});

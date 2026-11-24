import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isCodeThemeFilePath,
  isPluginOwnedIconPath,
  pluginPackageJsonSchema,
  type PluginPackageJson,
} from "@bb/domain";
import { isPathWithinDirectory } from "@bb/process-utils";
import { buildPluginApp } from "./build-plugin-app.js";
import { buildPluginServer } from "./build-plugin-server.js";
import { buildPluginHost } from "./build-plugin-host.js";
import { pathExists } from "./plugin-sdk-install.js";
import {
  resolveManifestAssetFile,
  resolveManifestPath,
} from "./plugin-manifest.js";
import type { PluginBuildToolchain } from "./toolchain.js";

const RUNTIME_DIRS = ["dist", "skills"] as const;

async function writeRuntimePackageJson(args: {
  packageJson: PluginPackageJson;
  targetDir: string;
}): Promise<void> {
  const packageJson = args.packageJson;
  await writeFile(
    path.join(args.targetDir, "package.json"),
    `${JSON.stringify(
      {
        ...packageJson,
        bb: {
          ...packageJson.bb,
          server: "./dist/server.js",
          ...(packageJson.bb.app === undefined ? {} : { app: "./dist/app.js" }),
          ...(packageJson.bb.host === undefined
            ? {}
            : { host: "./dist/host.js" }),
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function runStageAssets(sourceRoot: string): Promise<void> {
  const scriptPath = path.join(sourceRoot, "scripts", "stage-assets.mjs");
  if (!(await pathExists(scriptPath))) return;
  await import(pathToFileURL(scriptPath).href);
}

export async function copyPluginRuntime(args: {
  sourceRoot: string;
  targetDir: string;
}): Promise<void> {
  const sourceRoot = path.resolve(args.sourceRoot);
  const targetDir = path.resolve(args.targetDir);
  const packageJson = pluginPackageJsonSchema.parse(
    JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8")),
  );
  const realSourceRoot = await realpath(sourceRoot);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  async function copyEntry(entry: string, label: string): Promise<void> {
    const sourcePath = resolveManifestPath(sourceRoot, entry, label);
    const targetPath = resolveManifestPath(targetDir, entry, label);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, {
      recursive: true,
      dereference: true,
      filter: async (candidate) => {
        if (!isPathWithinDirectory(realSourceRoot, await realpath(candidate))) {
          throw new Error(
            `manifest ${label} escapes the plugin directory through a symlink`,
          );
        }
        return true;
      },
    });
  }

  await writeRuntimePackageJson({ packageJson, targetDir });
  for (const entry of [...RUNTIME_DIRS, "icon-sets/licenses"]) {
    if (await pathExists(path.join(sourceRoot, entry))) {
      await copyEntry(entry, entry);
    }
  }
  for (const entry of await readdir(sourceRoot)) {
    if (
      /^(?:licen[cs]es?|notices?|copying|copyright)(?:[.-].*)?$/iu.test(
        entry,
      ) ||
      entry === "SOURCE.md"
    ) {
      await copyEntry(entry, entry);
    }
  }
  const logo = packageJson.bb.branding.logo;
  const compactIcon = isPluginOwnedIconPath(packageJson.bb.branding.icon ?? "")
    ? packageJson.bb.branding.icon
    : undefined;
  const declaredIcons = Object.values(
    packageJson.bb.branding.experimental_icons ?? {},
  );
  for (const asset of [
    compactIcon,
    logo?.light,
    logo?.dark,
    ...declaredIcons,
  ]) {
    if (asset === undefined) continue;
    await resolveManifestAssetFile(
      sourceRoot,
      resolveManifestPath(sourceRoot, asset, "branding asset"),
      "branding asset",
    );
    await copyEntry(asset, "branding asset");
  }
  for (const theme of packageJson.bb.themes ?? []) {
    const assets = [
      theme.css,
      ...Object.values(theme.codeTheme ?? {}).filter(isCodeThemeFilePath),
    ];
    for (const asset of assets) {
      const label = `bb.themes.${theme.id}`;
      await resolveManifestAssetFile(
        sourceRoot,
        resolveManifestPath(sourceRoot, asset, label),
        label,
      );
      await copyEntry(asset, label);
    }
  }
}

export async function preparePluginRuntime(args: {
  sourceRoot: string;
  targetDir: string;
  bbVersion: string;
  toolchain: PluginBuildToolchain;
}): Promise<void> {
  const buildRoot = await mkdtemp(
    path.join(path.dirname(args.sourceRoot), ".bundled-stage-"),
  );
  try {
    await cp(args.sourceRoot, buildRoot, {
      recursive: true,
      filter: (entry) =>
        !["dist", "node_modules", ".turbo", ".bundled-runtime"].includes(
          path.relative(args.sourceRoot, entry).split(path.sep)[0],
        ),
    });
    const modules = path.join(args.sourceRoot, "node_modules");
    if (await pathExists(modules)) {
      await symlink(
        await realpath(modules),
        path.join(buildRoot, "node_modules"),
        "junction",
      );
    }
    const manifest = pluginPackageJsonSchema.parse(
      JSON.parse(await readFile(path.join(buildRoot, "package.json"), "utf8")),
    );
    await buildPluginServer(buildRoot, args.bbVersion, args.toolchain, {
      hostProvidedZod: true,
    });
    if (manifest.bb.app !== undefined)
      await buildPluginApp(buildRoot, args.bbVersion, args.toolchain, {
        minify: true,
        hostProvidedZod: true,
      });
    if (manifest.bb.host !== undefined)
      await buildPluginHost(buildRoot, args.bbVersion, args.toolchain);
    await runStageAssets(buildRoot);
    await copyPluginRuntime({
      sourceRoot: buildRoot,
      targetDir: args.targetDir,
    });
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

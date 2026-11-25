import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const output = join(packageRoot, "release-server");
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".pack-"));
try {
  const { stdout } = await run(
    "npm",
    ["pack", "--json", "--pack-destination", staging],
    { cwd: packageRoot, maxBuffer: 8 * 1024 * 1024 },
  );
  const packed = JSON.parse(stdout);
  if (
    !Array.isArray(packed) ||
    packed.length !== 1 ||
    typeof packed[0]?.filename !== "string" ||
    packed[0].filename.includes("/") ||
    packed[0].filename.includes("\\")
  )
    throw new Error("npm pack did not return one package filename");
  const artifact = join(staging, packed[0].filename);
  const bytes = await readFile(artifact);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  if (typeof manifest.version !== "string")
    throw new Error("Server package version is missing");
  const commit = (
    await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
  const dirty =
    (await run("git", ["status", "--porcelain"], { cwd: repoRoot })).stdout
      .length !== 0;
  await rename(artifact, join(output, "ai-server.tgz"));
  await writeFile(join(output, "sha256sums.txt"), `${sha256}  ai-server.tgz\n`);
  await writeFile(
    join(output, "build-info.json"),
    `${JSON.stringify({ version: manifest.version, commit, dirty, sha256, createdAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(
    `AI server ${manifest.version}: ${join(output, "ai-server.tgz")} (${bytes.length} bytes, SHA256 ${sha256})`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}

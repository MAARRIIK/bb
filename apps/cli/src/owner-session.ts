import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveRuntimeDataDir } from "@bb/config/runtime";
import { isLoopbackHostname } from "@bb/config/loopback";
import {
  createServerOwnerSession,
  readLocalServerOwnerCredentials,
  SERVER_OWNER_COOKIE_NAME,
} from "@bb/config/server-owner-auth";
import type { CreateNodeBbSdkArgs } from "@bb/sdk/node";
import { z } from "zod";

const sessionSchema = z
  .object({
    origin: z.string().url(),
    cookie: z
      .string()
      .regex(/^bb_owner_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
      .max(1200),
  })
  .strict();
type Session = z.infer<typeof sessionSchema>;

function sessionPath(baseUrl: string): string {
  const origin = new URL(baseUrl).origin;
  const dataDir = resolveRuntimeDataDir({
    env: process.env,
    homeDir: homedir(),
    mode: "prod",
  });
  return join(
    dataDir,
    "owner-sessions",
    `${createHash("sha256").update(origin).digest("hex")}.json`,
  );
}

export function loadCliOwnerSession(baseUrl: string): Session | undefined {
  const origin = new URL(baseUrl).origin;
  const path = sessionPath(baseUrl);
  if (existsSync(path)) {
    const info = statSync(path);
    if (
      !info.isFile() ||
      info.size > 4096 ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      throw new Error("Owner CLI session must be stored in a private file");
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const session = sessionSchema.parse(raw);
    return session.origin === origin ? session : undefined;
  }
  if (
    (process.env.BB_OWNER_AUTH === "true" ||
      process.env.BB_OWNER_AUTH === "1") &&
    isLoopbackHostname(new URL(origin).hostname)
  ) {
    const dataDir = resolveRuntimeDataDir({
      env: process.env,
      homeDir: homedir(),
      mode: "prod",
    });
    const credentials = readLocalServerOwnerCredentials(dataDir);
    return {
      origin,
      cookie: `${SERVER_OWNER_COOKIE_NAME}=${createServerOwnerSession(credentials)}`,
    };
  }
  return undefined;
}

export function saveCliOwnerSession(
  baseUrl: string,
  session: Parameters<
    NonNullable<CreateNodeBbSdkArgs["onOwnerSessionChange"]>
  >[0],
): void {
  const path = sessionPath(baseUrl);
  if (session === null) {
    rmSync(path, { force: true });
    return;
  }
  const parsed = sessionSchema.parse(session);
  if (parsed.origin !== new URL(baseUrl).origin)
    throw new Error("Owner session origin does not match the server");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(parsed)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

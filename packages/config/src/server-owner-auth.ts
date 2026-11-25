import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

function derivePassword(
  password: string,
  salt: string,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (error, key) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}
const FILE_NAME = "server-owner-auth.json";
export const SERVER_OWNER_COOKIE_NAME = "bb_owner_session";
export const SERVER_OWNER_SESSION_SECONDS = 7 * 24 * 60 * 60;
const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^\p{Cc}]+$/u);
const credentialsSchema = z
  .object({
    version: z.literal(1),
    username: usernameSchema,
    salt: z.string().regex(/^[a-f0-9]{32}$/u),
    passwordHash: z.string().regex(/^[a-f0-9]{128}$/u),
    sessionSigningKey: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const claimsSchema = z
  .object({
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    nonce: z.string().regex(/^[a-f0-9]{32}$/u),
  })
  .strict();
export type ServerOwnerCredentials = z.infer<typeof credentialsSchema>;
export type ServerOwnerSession = z.infer<typeof claimsSchema>;

export async function setLocalServerOwnerPassword(args: {
  dataDir: string;
  username: string;
  password: string;
}): Promise<void> {
  const username = usernameSchema.parse(args.username);
  if (args.password.length < 12 || args.password.length > 512) {
    throw new Error(
      "Owner password must contain between 12 and 512 characters",
    );
  }
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await derivePassword(args.password, salt, 64);
  const credentials: ServerOwnerCredentials = {
    version: 1,
    username,
    salt,
    passwordHash: passwordHash.toString("hex"),
    sessionSigningKey: randomBytes(32).toString("hex"),
  };
  await mkdir(args.dataDir, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    args.dataDir,
    `.${FILE_NAME}.${randomBytes(16).toString("hex")}`,
  );
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(credentials)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, join(args.dataDir, FILE_NAME));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function readLocalServerOwnerCredentials(
  dataDir: string,
): ServerOwnerCredentials {
  try {
    const path = join(dataDir, FILE_NAME);
    const info = statSync(path);
    if (
      !info.isFile() ||
      info.size > 2048 ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    ) {
      throw new Error("Invalid owner credential file");
    }
    return credentialsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error(
      "Owner authentication requires a valid private server-owner-auth.json credential file. Set an owner password before enabling BB_OWNER_AUTH.",
    );
  }
}

export async function verifyServerOwnerPassword(
  credentials: ServerOwnerCredentials,
  username: string,
  password: string,
): Promise<boolean> {
  if (username.length > 128 || password.length > 512) return false;
  const hash = await derivePassword(password, credentials.salt, 64);
  const userHash = createHmac("sha256", credentials.sessionSigningKey)
    .update(username)
    .digest();
  const expectedUserHash = createHmac("sha256", credentials.sessionSigningKey)
    .update(credentials.username)
    .digest();
  const passwordMatches = timingSafeEqual(
    hash,
    Buffer.from(credentials.passwordHash, "hex"),
  );
  return timingSafeEqual(userHash, expectedUserHash) && passwordMatches;
}

export function createServerOwnerSession(
  credentials: ServerOwnerCredentials,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt,
      expiresAt: issuedAt + SERVER_OWNER_SESSION_SECONDS,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  const signature = createHmac(
    "sha256",
    Buffer.from(credentials.sessionSigningKey, "hex"),
  )
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyServerOwnerSession(
  credentials: ServerOwnerCredentials,
  token: string | undefined,
  now = Date.now(),
): ServerOwnerSession | null {
  if (
    token === undefined ||
    token.length > 1024 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(token)
  )
    return null;
  const [payload, signature] = token.split(".");
  if (payload === undefined || signature === undefined) return null;
  const expected = createHmac(
    "sha256",
    Buffer.from(credentials.sessionSigningKey, "hex"),
  )
    .update(payload)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const parsed = claimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    const current = Math.floor(now / 1000);
    return parsed.success &&
      parsed.data.issuedAt <= current &&
      parsed.data.expiresAt > current &&
      parsed.data.expiresAt - parsed.data.issuedAt ===
        SERVER_OWNER_SESSION_SECONDS
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

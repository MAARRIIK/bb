import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createServerOwnerSession,
  readLocalServerOwnerCredentials,
  SERVER_OWNER_SESSION_SECONDS,
  setLocalServerOwnerPassword,
  verifyServerOwnerPassword,
  verifyServerOwnerSession,
} from "../src/server-owner-auth.js";

const directories: string[] = [];
async function createDirectory() {
  const path = await mkdtemp(join(tmpdir(), "bb-owner-auth-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local server owner credentials", () => {
  it("stores a private salted password and rotates sessions when the password changes", async () => {
    const dataDir = await createDirectory();
    await setLocalServerOwnerPassword({
      dataDir,
      username: "owner",
      password: "a unique owner password",
    });
    const path = join(dataDir, "server-owner-auth.json");
    expect(await readFile(path, "utf8")).not.toContain(
      "a unique owner password",
    );
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    const credentials = readLocalServerOwnerCredentials(dataDir);
    expect(
      await verifyServerOwnerPassword(
        credentials,
        "owner",
        "a unique owner password",
      ),
    ).toBe(true);
    expect(
      await verifyServerOwnerPassword(
        credentials,
        "other",
        "a unique owner password",
      ),
    ).toBe(false);
    expect(
      await verifyServerOwnerPassword(credentials, "owner", "wrong password"),
    ).toBe(false);
    const session = createServerOwnerSession(credentials);
    await setLocalServerOwnerPassword({
      dataDir,
      username: "owner",
      password: "a new unique owner password",
    });
    const rotated = readLocalServerOwnerCredentials(dataDir);
    expect(verifyServerOwnerSession(rotated, session)).toBeNull();
    expect(
      await verifyServerOwnerPassword(
        rotated,
        "owner",
        "a unique owner password",
      ),
    ).toBe(false);
    expect(
      await verifyServerOwnerPassword(
        rotated,
        "owner",
        "a new unique owner password",
      ),
    ).toBe(true);
  });

  it("rejects missing, malformed, and publicly readable credential files", async () => {
    const dataDir = await createDirectory();
    const path = join(dataDir, "server-owner-auth.json");
    expect(() => readLocalServerOwnerCredentials(dataDir)).toThrow(
      "requires a valid private",
    );
    await writeFile(path, '{"version":1}', { mode: 0o600 });
    expect(() => readLocalServerOwnerCredentials(dataDir)).toThrow(
      "requires a valid private",
    );
    await setLocalServerOwnerPassword({
      dataDir,
      username: "owner",
      password: "a unique owner password",
    });
    if (process.platform !== "win32") {
      await chmod(path, 0o644);
      expect(() => readLocalServerOwnerCredentials(dataDir)).toThrow(
        "requires a valid private",
      );
    }
    await expect(
      setLocalServerOwnerPassword({
        dataDir,
        username: "owner",
        password: "short",
      }),
    ).rejects.toThrow("between 12 and 512");
  });

  it("rejects tampered, expired, future, and oversized session tokens", async () => {
    const dataDir = await createDirectory();
    await setLocalServerOwnerPassword({
      dataDir,
      username: "owner",
      password: "a unique owner password",
    });
    const credentials = readLocalServerOwnerCredentials(dataDir);
    const now = 1_000_000;
    const token = createServerOwnerSession(credentials, now);
    expect(verifyServerOwnerSession(credentials, token, now)).toMatchObject({
      issuedAt: now / 1000,
    });
    expect(
      verifyServerOwnerSession(
        credentials,
        token,
        now + SERVER_OWNER_SESSION_SECONDS * 1000,
      ),
    ).toBeNull();
    expect(verifyServerOwnerSession(credentials, token, now - 1000)).toBeNull();
    expect(
      verifyServerOwnerSession(credentials, `a${token.slice(1)}`, now),
    ).toBeNull();
    expect(
      verifyServerOwnerSession(credentials, "a".repeat(2048), now),
    ).toBeNull();
  });
});

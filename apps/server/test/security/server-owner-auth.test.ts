import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHosts, updateHost, upsertHost } from "@bb/db";
import { setLocalServerOwnerPassword } from "@bb/config/server-owner-auth";
import { HOST_API_AUTH_HEADER } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createTestAppHarness,
  startTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";
import { readJson } from "../helpers/json.js";

const password = "a private owner password";
const loginPath = "/api/v1/owner-auth/login";
const statusPath = "/api/v1/owner-auth/status";

async function withOwnerApp(run: (harness: TestAppHarness) => Promise<void>) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-owner-server-"));
  try {
    await setLocalServerOwnerPassword({ dataDir, username: "owner", password });
    const harness = await createTestAppHarness({
      dataDir,
      ownerAuthEnabled: true,
      seedFirstPartyProviders: false,
    });
    try {
      await run(harness);
    } finally {
      await harness.cleanup();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function login(
  harness: TestAppHarness,
  secret = password,
  origin = "https://bb.example.test",
) {
  return harness.app.request(loginPath, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username: "owner", password: secret }),
  });
}

function responseCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (cookie === undefined) throw new Error("Expected owner session cookie");
  return cookie;
}

describe("self-hosted owner authentication", () => {
  it("protects API, websocket, internal enrollment and bootstrap while exposing minimal health and status", async () => {
    await withOwnerApp(async (harness) => {
      for (const [path, method] of [
        ["/api/v1/projects", "GET"],
        ["/ws", "GET"],
        ["/internal/hosts/enroll-key", "POST"],
        ["/internal/server-move/pending", "GET"],
      ]) {
        const response = await harness.app.request(path, {
          method,
          headers: {
            "x-bb-gate-auth": "session",
            "x-bb-gate-machine-id": "forged",
          },
        });
        expect(response.status, path).toBe(401);
      }
      expect(await readJson(await harness.app.request("/health"))).toEqual({
        ok: true,
      });
      expect(await readJson(await harness.app.request(statusPath))).toEqual({
        enabled: true,
        authenticated: false,
      });
      const page = await harness.app.request("/", {
        headers: { accept: "text/html" },
      });
      expect(page.status).toBe(303);
      expect(page.headers.get("location")).toBe("/auth/login");
      const loginPage = await harness.app.request("/auth/login");
      expect(loginPage.status).toBe(200);
      expect(await loginPage.text()).toContain(
        'autocomplete="current-password"',
      );
      for (const path of ["/install.sh", "/install.ps1"]) {
        expect((await harness.app.request(path)).status).toBe(401);
        const invalid = await harness.app.request(path, {
          headers: { "X-BB-Enrollment": "invalid" },
        });
        expect(invalid.status).toBe(path === "/install.sh" ? 403 : 200);
        expect(await invalid.text()).toContain(
          "already been used, replaced, or expired",
        );
      }
      expect(listHosts(harness.db)).toHaveLength(0);
    });
  });

  it("establishes a secure owner cookie, keeps daemon Bearer checks, logs out, and invalidates a rotated password", async () => {
    await withOwnerApp(async (harness) => {
      expect((await login(harness, "bad password")).status).toBe(401);
      expect(
        (await login(harness, password, "https://attacker.example")).status,
      ).toBe(401);
      const response = await login(harness);
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        enabled: true,
        authenticated: true,
      });
      const setCookie = response.headers.get("set-cookie") ?? "";
      for (const attribute of [
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/",
        "Max-Age=604800",
      ])
        expect(setCookie).toContain(attribute);
      const cookie = responseCookie(response);
      expect(
        await readJson(
          await harness.app.request(statusPath, { headers: { cookie } }),
        ),
      ).toEqual({ enabled: true, authenticated: true });
      expect(
        (await harness.app.request("/api/v1/projects", { headers: { cookie } }))
          .status,
      ).toBe(200);
      expect(
        (
          await harness.app.request("/internal/session/events", {
            method: "POST",
            headers: { cookie },
          })
        ).status,
      ).toBe(401);
      const logout = await harness.app.request("/api/v1/owner-auth/logout", {
        method: "POST",
        headers: { cookie },
      });
      expect(await readJson(logout)).toEqual({
        enabled: true,
        authenticated: false,
      });
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      await setLocalServerOwnerPassword({
        dataDir: harness.config.dataDir,
        username: "owner",
        password: "a different owner password",
      });
      expect(
        (await harness.app.request("/api/v1/projects", { headers: { cookie } }))
          .status,
      ).toBe(401);
      expect((await login(harness)).status).toBe(401);
      expect((await login(harness, "a different owner password")).status).toBe(
        200,
      );
    });
  });

  it("accepts actual paired-machine keys without owner privileges and rejects revoked or destroyed machines", async () => {
    await withOwnerApp(async (harness) => {
      upsertHost(harness.db, harness.hub, {
        id: "paired-machine",
        name: "Paired PC",
      });
      const key = await harness.deps.machineAuth.issueDaemonHostKey({
        hostId: "paired-machine",
      });
      const headers = {
        [HOST_API_AUTH_HEADER]: key,
        "x-bb-gate-auth": "session",
        "x-bb-gate-machine-id": "forged",
      };
      expect(
        (await harness.app.request("/api/v1/projects", { headers })).status,
      ).toBe(200);
      for (const request of [
        { method: "POST", path: "/api/v1/plugins/install" },
        { method: "POST", path: "/api/v1/plugin-catalog/install" },
        { method: "POST", path: "/api/v1/plugins/existing/update" },
        { method: "POST", path: "/api/v1/plugins/existing/enable" },
        { method: "POST", path: "/api/v1/plugins/existing/disable" },
        { method: "POST", path: "/api/v1/plugins/reload" },
        { method: "DELETE", path: "/api/v1/plugins/existing" },
        { method: "PUT", path: "/api/v1/plugins/safe-mode" },
        { method: "POST", path: "/api/v1/plugins/cache/prune" },
        { method: "POST", path: "/api/v1/plugins/updates/check" },
        {
          method: "POST",
          path: "/api/v1/plugins/install-jobs/existing/cancel",
        },
        { method: "POST", path: "/api/v1/marketplaces" },
        { method: "PATCH", path: "/api/v1/marketplaces/existing" },
        { method: "DELETE", path: "/api/v1/marketplaces/existing" },
        { method: "POST", path: "/api/v1/marketplaces/refresh" },
      ]) {
        const denied = await harness.app.request(request.path, {
          method: request.method,
          headers: { ...headers, "content-type": "application/json" },
          body: "{}",
        });
        expect(denied.status, request.path).toBe(403);
        expect(await readJson(denied)).toMatchObject({
          code: "machine_plugin_management_forbidden",
        });
      }
      const ownerCookie = responseCookie(await login(harness));
      expect(
        (
          await harness.app.request("/api/v1/plugins/install", {
            method: "POST",
            headers: {
              cookie: ownerCookie,
              "content-type": "application/json",
            },
            body: "{}",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await harness.app.request("/api/v1/plugins/existing/settings", {
            method: "PUT",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ values: {} }),
          })
        ).status,
      ).toBe(404);
      const forbidden = await harness.app.request(
        "/internal/hosts/enroll-key",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(forbidden.status).toBe(403);
      expect(await readJson(forbidden)).toMatchObject({
        code: "machine_host_management_forbidden",
      });
      expect(
        (
          await harness.app.request("/api/v1/projects", {
            headers: { [HOST_API_AUTH_HEADER]: "forged" },
          })
        ).status,
      ).toBe(401);
      await harness.deps.machineAuth.revokeHostAuthKeys({
        hostId: "paired-machine",
      });
      expect(
        (await harness.app.request("/api/v1/projects", { headers })).status,
      ).toBe(401);
      const replacement = await harness.deps.machineAuth.issueDaemonHostKey({
        hostId: "paired-machine",
      });
      updateHost(harness.db, harness.hub, "paired-machine", {
        destroyedAt: Date.now(),
      });
      expect(
        (
          await harness.app.request("/api/v1/projects", {
            headers: { [HOST_API_AUTH_HEADER]: replacement },
          })
        ).status,
      ).toBe(401);
    });
  });

  it("revokes active and idle real owner WebSockets after credential rotation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-owner-websocket-"));
    const sockets: WebSocket[] = [];
    try {
      await setLocalServerOwnerPassword({
        dataDir,
        username: "owner",
        password,
      });
      const server = await startTestServer({
        dataDir,
        ownerAuthEnabled: true,
        seedFirstPartyProviders: false,
      });
      try {
        const cookie = responseCookie(await login(server));
        const open = async () => {
          const socket = new WebSocket(
            `${server.baseUrl.replace("http:", "ws:")}/ws`,
            { headers: { cookie } },
          );
          sockets.push(socket);
          await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          });
          return socket;
        };
        const active = await open();
        const idle = await open();
        const pong = new Promise<string>((resolve) =>
          active.once("message", (data) => resolve(data.toString())),
        );
        active.send(JSON.stringify({ type: "ping" }));
        expect(await pong).toBe(JSON.stringify({ type: "pong" }));
        const activeClosed = new Promise<number>((resolve) =>
          active.once("close", (code) => resolve(code)),
        );
        const idleClosed = new Promise<number>((resolve) =>
          idle.once("close", (code) => resolve(code)),
        );
        let messagesAfterRotation = 0;
        active.on("message", () => {
          messagesAfterRotation += 1;
        });
        await setLocalServerOwnerPassword({
          dataDir,
          username: "owner",
          password: "a rotated websocket password",
        });
        active.send(JSON.stringify({ type: "ping" }));
        await expect
          .poll(() => [active.readyState, idle.readyState], { timeout: 3000 })
          .toEqual([WebSocket.CLOSED, WebSocket.CLOSED]);
        await expect(activeClosed).resolves.toBe(1008);
        await expect(idleClosed).resolves.toBe(1008);
        expect(messagesAfterRotation).toBe(0);
      } finally {
        for (const socket of sockets) socket.terminate();
        await server.close();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("revokes active and idle real machine WebSockets after key revocation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-machine-websocket-"));
    const sockets: WebSocket[] = [];
    try {
      await setLocalServerOwnerPassword({
        dataDir,
        username: "owner",
        password,
      });
      const server = await startTestServer({
        dataDir,
        ownerAuthEnabled: true,
        seedFirstPartyProviders: false,
      });
      try {
        const hostId = "paired-websocket-machine";
        upsertHost(server.db, server.hub, {
          id: hostId,
          name: "Paired websocket PC",
        });
        const key = await server.deps.machineAuth.issueDaemonHostKey({
          hostId,
        });
        const open = async () => {
          const socket = new WebSocket(
            `${server.baseUrl.replace("http:", "ws:")}/ws`,
            { headers: { [HOST_API_AUTH_HEADER]: key } },
          );
          sockets.push(socket);
          await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          });
          return socket;
        };
        const active = await open();
        const idle = await open();
        const pong = new Promise<string>((resolve) =>
          active.once("message", (data) => resolve(data.toString())),
        );
        active.send(JSON.stringify({ type: "ping" }));
        expect(await pong).toBe(JSON.stringify({ type: "pong" }));
        const activeClosed = new Promise<number>((resolve) =>
          active.once("close", (code) => resolve(code)),
        );
        const idleClosed = new Promise<number>((resolve) =>
          idle.once("close", (code) => resolve(code)),
        );
        let messagesAfterRevocation = 0;
        active.on("message", () => {
          messagesAfterRevocation += 1;
        });
        await server.deps.machineAuth.revokeHostAuthKeys({ hostId });
        active.send(JSON.stringify({ type: "ping" }));
        await expect
          .poll(() => [active.readyState, idle.readyState], { timeout: 3000 })
          .toEqual([WebSocket.CLOSED, WebSocket.CLOSED]);
        await expect(activeClosed).resolves.toBe(1008);
        await expect(idleClosed).resolves.toBe(1008);
        expect(messagesAfterRevocation).toBe(0);
      } finally {
        for (const socket of sockets) socket.terminate();
        await server.close();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("bounds failed login attempts and rejects oversized malformed credentials", async () => {
    await withOwnerApp(async (harness) => {
      expect(
        (
          await harness.app.request(loginPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "a".repeat(16384),
          })
        ).status,
      ).toBe(401);
      for (let attempt = 0; attempt < 4; attempt += 1)
        expect((await login(harness, "wrong password")).status).toBe(401);
      const limited = await login(harness);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(limited.headers.get("set-cookie")).toBeNull();
    });
  });

  it("accepts a maximum-length Unicode password through the browser form", async () => {
    await withOwnerApp(async (harness) => {
      const secret = "я".repeat(512);
      await setLocalServerOwnerPassword({
        dataDir: harness.config.dataDir,
        username: "owner",
        password: secret,
      });
      const response = await harness.app.request("/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://bb.example.test",
        },
        body: new URLSearchParams({
          username: "owner",
          password: secret,
        }).toString(),
      });
      expect(response.status).toBe(303);
      expect(responseCookie(response)).toMatch(/^bb_owner_session=/u);
    });
  });
});

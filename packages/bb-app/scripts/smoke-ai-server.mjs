import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--package-root")) {
  throw new Error(
    "Usage: smoke-ai-server.mjs [--package-root <installed bb-app>]",
  );
}
const root = await mkdtemp(join(tmpdir(), "ai-server-smoke-"));
const data = join(root, "server");
const clientData = join(root, "client");
const worker = join(root, "worker");
const backup = join(root, "backup");
const restored = join(root, "restored");
const password = randomBytes(24).toString("base64url");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("BB_")),
);
Object.assign(env, {
  HOME: root,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "xdg-data"),
  BB_TELEMETRY: "false",
});
try {
  let packageRoot;
  if (args.length === 2) {
    packageRoot = resolve(args[1]);
  } else {
    const installRoot = join(root, "install");
    const tarball = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../release-server/ai-server.tgz",
    );
    const npm = spawn(
      "npm",
      [
        "install",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installRoot,
        tarball,
      ],
      {
        cwd: root,
        env: { ...env, HOME: process.env.HOME },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    npm.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const timer = setTimeout(() => npm.kill("SIGKILL"), 300000);
    let code;
    try {
      code = await new Promise((done, reject) => {
        npm.once("error", reject);
        npm.once("close", done);
      });
    } finally {
      clearTimeout(timer);
    }
    if (code !== 0)
      throw new Error(
        `npm install failed (${code ?? "timeout"}): ${stderr.replace(/(?:Bearer\s+|_authToken=)[^\s"']+/giu, "[redacted]").replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "[redacted]")}`,
      );
    packageRoot = join(installRoot, "node_modules", "bb-app");
  }
  const { BBSdk } = await import(
    pathToFileURL(join(packageRoot, "dist/index.js"))
  );
  const processes = new Set();
  const secrets = [password];
  const delay = (ms) => new Promise((done) => setTimeout(done, ms));

  async function freePort() {
    const listener = createServer();
    await new Promise((done, reject) =>
      listener.once("error", reject).listen(0, "127.0.0.1", done),
    );
    const port = listener.address().port;
    await new Promise((done, reject) =>
      listener.close((error) => (error ? reject(error) : done())),
    );
    return port;
  }

  async function command(args, input, overrides = {}) {
    const child = spawn(
      process.execPath,
      [join(packageRoot, "dist/bb.js"), ...args],
      {
        cwd: root,
        env: { ...env, BB_DATA_DIR: clientData, ...overrides },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.stdin.end(input === undefined ? undefined : `${input}\n`);
    const code = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    if (code !== 0)
      throw new Error(
        `CLI ${args.slice(0, 3).join(" ")} failed (${code}): ${err.replaceAll(password, "[redacted]")}`,
      );
    return out;
  }

  function clean(text) {
    for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
    return text
      .replace(/(?:Bearer\s+|bb_owner_session=)[^\s"']+/giu, "[redacted]")
      .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "[redacted]");
  }

  async function diagnostics(directory, label, output) {
    let log = "";
    try {
      log = await readFile(
        join(directory, "logs", `${label}-stdio.log`),
        "utf8",
      );
    } catch {}
    return clean(`${output.slice(-8000)}\n${log.slice(-8000)}`);
  }

  async function portClosed(port) {
    for (let n = 0; n < 100; n++) {
      const listener = createServer();
      const available = await new Promise((done) => {
        listener.once("error", () => done(false));
        listener.listen(port, "127.0.0.1", () =>
          listener.close(() => done(true)),
        );
      });
      if (available) return;
      await delay(100);
    }
    throw new Error(`Owned process did not release port ${port}`);
  }

  async function stop(processRef) {
    if (!processRef) return;
    const { child, port } = processRef;
    const signal = (value) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, value);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    await delay(1000);
    signal("SIGKILL");
    if (
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      await Promise.race([
        new Promise((done) => child.once("exit", done)),
        delay(5000).then(() => {
          throw new Error("Owned process did not exit");
        }),
      ]);
    }
    await portClosed(port);
    processes.delete(processRef);
  }

  function launch(binary, args, directory, port, overrides = {}) {
    const child = spawn(
      process.execPath,
      [join(packageRoot, `dist/${binary}.js`), ...args],
      {
        cwd: root,
        env: { ...env, ...overrides },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const ref = {
      child,
      port,
      directory,
      label: binary === "bb-server" ? "server" : "host-daemon",
      output: "",
      error: null,
    };
    child.once("error", (error) => {
      ref.error = error;
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        ref.output = (ref.output + chunk).slice(-16000);
      });
    processes.add(ref);
    return ref;
  }

  async function failStartup(ref, message) {
    throw new Error(
      `${message}\n${await diagnostics(ref.directory, ref.label, ref.output)}${ref.error ? `\n${clean(String(ref.error))}` : ""}`,
    );
  }

  async function start(directory, port) {
    const baseUrl = `http://127.0.0.1:${port}`;
    const ref = launch(
      "bb-server",
      [
        "--data-dir",
        directory,
        "--server-bind-host",
        "127.0.0.1",
        "--server-port",
        String(port),
      ],
      directory,
      port,
      {
        BB_OWNER_AUTH: "true",
        BB_APP_URL: baseUrl,
        BB_EXTERNAL_URL: baseUrl,
        BB_SERVER_LAUNCH_ID: randomUUID(),
      },
    );
    for (let n = 0; n < 240; n++) {
      if (
        ref.error ||
        ref.child.exitCode !== null ||
        ref.child.signalCode !== null
      )
        await failStartup(ref, "Server exited before becoming ready");
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) return { ...ref, baseUrl, ref };
      } catch {}
      await delay(250);
    }
    await failStartup(ref, "Server did not become ready");
  }

  async function startWorker(sdk, baseUrl, port) {
    const { joinCode, hostId } = await sdk.hosts.createJoinCode();
    secrets.push(joinCode);
    const ref = launch(
      "bb-host-daemon",
      [
        "join",
        "--data-dir",
        worker,
        "--server-url",
        baseUrl,
        "--host-daemon-port",
        String(port),
        "--join-code",
        joinCode,
        "--host-id",
        hostId,
      ],
      worker,
      port,
    );
    for (let n = 0; n < 240; n++) {
      if (
        ref.error ||
        ref.child.exitCode !== null ||
        ref.child.signalCode !== null
      )
        await failStartup(ref, "Machine exited before connecting");
      try {
        if ((await sdk.hosts.get({ hostId })).status === "connected")
          return { ref, hostId };
      } catch {}
      await delay(250);
    }
    await failStartup(ref, "Machine did not connect");
  }

  async function denyWebSocket(baseUrl) {
    const result = await new Promise((done, reject) => {
      const socket = new WebSocket(`${baseUrl.replace("http:", "ws:")}/ws`);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("WebSocket denial timed out"));
      }, 5000);
      socket.onopen = () => {
        clearTimeout(timer);
        socket.close();
        reject(new Error("Unauthenticated WebSocket opened"));
      };
      socket.onerror = () => {
        clearTimeout(timer);
        done(true);
      };
    });
    assert.equal(result, true);
  }

  try {
    const port = await freePort();
    await command(
      [
        "server",
        "auth",
        "set-password",
        "--data-dir",
        data,
        "--username",
        "owner",
        "--password-stdin",
      ],
      password,
    );
    let server = await start(data, port);
    const cliEnv = { BB_SERVER_URL: server.baseUrl };
    assert.equal(
      (await fetch(`${server.baseUrl}/api/v1/projects`)).status,
      401,
    );
    await denyWebSocket(server.baseUrl);
    const status = async () =>
      JSON.parse(
        await command(
          ["server", "auth", "status", "--json"],
          undefined,
          cliEnv,
        ),
      );
    assert.equal((await status()).authenticated, false);
    await command(
      [
        "server",
        "auth",
        "login",
        "--username",
        "owner",
        "--password-stdin",
        "--json",
      ],
      password,
      cliEnv,
    );
    assert.equal((await status()).authenticated, true);
    const sessions = await readdir(join(clientData, "owner-sessions"));
    assert.equal(sessions.length, 1);
    assert.equal(
      (await stat(join(clientData, "owner-sessions", sessions[0]))).mode &
        0o077,
      0,
    );
    await command(["server", "auth", "logout", "--json"], undefined, cliEnv);
    assert.equal((await status()).authenticated, false);
    const first = new BBSdk({ baseUrl: server.baseUrl });
    const second = new BBSdk({ baseUrl: server.baseUrl });
    await first.experimental_ownerAuth.login({ username: "owner", password });
    await second.experimental_ownerAuth.login({ username: "owner", password });
    const configuration = await first.system.config();
    assert.equal(configuration.generalSettings.defaultMachineAccess, "direct");
    assert.equal(configuration.serverAccess.defaultProviderId, "direct");
    assert.equal(configuration.serverAccess.effectiveUrl, server.baseUrl);
    const daemonPort = await freePort();
    const machine = await startWorker(first, server.baseUrl, daemonPort);
    const projects = await first.projects.list({ includePersonal: true });
    assert.deepEqual(
      await second.projects.list({ includePersonal: true }),
      projects,
    );
    const personal = projects.find((project) => project.kind === "personal");
    assert.ok(personal, "Personal project must exist");
    const title = `Smoke ${randomUUID()}`;
    const thread = await first.threads.spawn({
      projectId: personal.id,
      origin: "sdk",
      title,
      input: [{ type: "text", text: title, mentions: [] }],
      environment: {
        type: "host",
        hostId: machine.hostId,
        workspace: { type: "personal" },
      },
      providerId: "codex",
      model: "smoke-model",
      sendAt: Date.now() + 86400000,
    });
    assert.equal(
      (await second.threads.get({ threadId: thread.id })).title,
      title,
    );
    assert.deepEqual(
      await first.experimental_promptHistory.list(),
      await second.experimental_promptHistory.list(),
    );
    await stop(machine.ref);
    await stop(server.ref);
    await cp(data, backup, { recursive: true });
    server = await start(data, port);
    const restarted = new BBSdk({ baseUrl: server.baseUrl });
    await restarted.experimental_ownerAuth.login({
      username: "owner",
      password,
    });
    assert.equal(
      (await restarted.threads.get({ threadId: thread.id })).title,
      title,
    );
    await stop(server.ref);
    await cp(backup, restored, { recursive: true });
    server = await start(restored, port);
    const recovered = new BBSdk({ baseUrl: server.baseUrl });
    await recovered.experimental_ownerAuth.login({
      username: "owner",
      password,
    });
    assert.equal(
      (await recovered.threads.get({ threadId: thread.id })).title,
      title,
    );
    await stop(server.ref);
    console.log("AI server package smoke passed");
  } finally {
    await Promise.all([...processes].map(stop));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

import { getNonDestroyedHost } from "@bb/db";
import { isLoopbackHostname } from "@bb/config/loopback";
import {
  createServerOwnerSession,
  readLocalServerOwnerCredentials,
  SERVER_OWNER_COOKIE_NAME,
  SERVER_OWNER_SESSION_SECONDS,
  verifyServerOwnerPassword,
  verifyServerOwnerSession,
} from "@bb/config/server-owner-auth";
import { HOST_API_AUTH_HEADER } from "@bb/host-daemon-contract";
import type { Context, Hono } from "hono";
import type { WSEvents } from "hono/ws";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  OWNER_AUTH_PATHS,
  ownerAuthLoginSchema,
  type OwnerAuthLogin,
  type OwnerAuthStatus,
} from "@bb/server-contract";
import { allowedAppOrigins } from "../browser-request-guard.js";
import { getTrustedRemoteAddress } from "../request-context.js";
import type { ServerAppDeps } from "../types.js";
import {
  PLUGIN_RPC_CALLER_HEADER,
  type PluginRpcCallerResolution,
} from "./plugins/plugin-rpc-caller.js";

const LOGIN_HTML = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Вход в AI</title><style>:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0;min-height:100svh;display:grid;place-items:center;background:Canvas;color:CanvasText}main{width:min(22rem,calc(100vw - 3rem));padding:2rem 0}h1{font-size:2rem;margin:0 0 .5rem}p{line-height:1.5;opacity:.75}label{display:block;margin-top:1.25rem}input,button{box-sizing:border-box;width:100%;font:inherit;padding:.8rem;margin-top:.4rem;border-radius:.6rem;border:1px solid color-mix(in oklab,CanvasText 25%,Canvas)}input{background:Canvas;color:CanvasText}button{margin-top:1.5rem;background:CanvasText;color:Canvas;cursor:pointer}small{display:block;margin-top:1rem;line-height:1.5}</style><main><h1>AI</h1><p>Войдите, чтобы открыть ваши проекты и диалоги.</p><form method="post" action="/auth/login"><label for="username">Имя пользователя</label><input id="username" name="username" autocomplete="username" maxlength="128" required autofocus><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="512" required><button type="submit">Войти</button></form></main></html>`;

function loginHtml(context: Context, failed: boolean): Response {
  return context.html(
    failed
      ? LOGIN_HTML.replace(
          "<form",
          '<p role="alert">Не удалось войти. Проверьте имя пользователя и пароль.</p><form',
        )
      : LOGIN_HTML,
    failed ? 401 : 200,
    {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "same-origin",
    },
  );
}

function unauthorized(context: Context): Response {
  context.header("cache-control", "no-store");
  return context.req.path === "/auth/login" && context.req.method === "POST"
    ? loginHtml(context, true)
    : context.json({ code: "unauthorized", message: "Unauthorized" }, 401);
}

async function readLogin(context: Context): Promise<OwnerAuthLogin | null> {
  if (Number(context.req.header("content-length") ?? 0) > 2048) return null;
  const body = context.req.raw.body;
  if (body === null) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 2048) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const contentType = context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const raw: unknown =
      contentType === "application/json"
        ? JSON.parse(text)
        : contentType === "application/x-www-form-urlencoded"
          ? Object.fromEntries(new URLSearchParams(text))
          : null;
    const parsed = ownerAuthLoginSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function isPluginAdministrationRequest(path: string, method: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return false;
  return (
    path === "/api/v1/plugin-catalog/install" ||
    path === "/api/v1/marketplaces" ||
    /^\/api\/v1\/marketplaces\/[^/]+$/u.test(path) ||
    (method === "POST" &&
      (path === "/api/v1/plugins/install" ||
        path === "/api/v1/plugins/reload" ||
        path === "/api/v1/plugins/updates/check" ||
        path === "/api/v1/plugins/cache/prune" ||
        /^\/api\/v1\/plugins\/[^/]+\/(?:update|enable|disable)$/u.test(path) ||
        /^\/api\/v1\/plugins\/install-jobs\/[^/]+\/cancel$/u.test(path))) ||
    (method === "PUT" && path === "/api/v1/plugins/safe-mode") ||
    (method === "DELETE" && /^\/api\/v1\/plugins\/[^/]+$/u.test(path))
  );
}

interface ServerOwnerAuth {
  guardWebSocket<T>(context: Context, events: WSEvents<T>): WSEvents<T>;
  dispose(): void;
}

export function registerServerOwnerAuth(
  app: Hono,
  deps: ServerAppDeps,
  resolvePluginCaller: (token: string | undefined) => PluginRpcCallerResolution,
): ServerOwnerAuth {
  const enabled = deps.config.ownerAuthEnabled;
  const appUrl =
    deps.config.appUrl === undefined ? null : new URL(deps.config.appUrl);
  const secure = appUrl?.protocol === "https:";
  if (enabled) {
    if (
      appUrl === null ||
      (!secure &&
        !(appUrl.protocol === "http:" && isLoopbackHostname(appUrl.hostname)))
    ) {
      throw new Error(
        "BB_OWNER_AUTH requires an HTTPS BB_APP_URL, except for loopback development",
      );
    }
    readLocalServerOwnerCredentials(deps.config.dataDir);
  }
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  let globalWindow = { count: 0, expiresAt: 0 };
  let activeLogins = 0;
  const authenticated = (context: Context): boolean =>
    enabled &&
    verifyServerOwnerSession(
      readLocalServerOwnerCredentials(deps.config.dataDir),
      getCookie(context, SERVER_OWNER_COOKIE_NAME),
    ) !== null;
  const status = (context: Context): OwnerAuthStatus => ({
    enabled,
    authenticated: authenticated(context),
  });
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: "Strict" as const,
    path: "/",
  };
  const checkOrigin = (context: Context): boolean => {
    const origin = context.req.header("origin");
    return origin === undefined || allowedAppOrigins(deps).has(origin);
  };

  app.use("*", async (context, next) => {
    if (!enabled) return next();
    context.req.raw.headers.delete("x-bb-gate-auth");
    context.req.raw.headers.delete("x-bb-gate-machine-id");
    const path = context.req.path.replace(/\/+$/u, "") || "/";
    if (
      (path === "/health" ||
        path === "/install/version" ||
        path === "/install/bb-app.tgz") &&
      (context.req.method === "GET" || context.req.method === "HEAD")
    )
      return next();
    if (
      (path === "/auth/login" &&
        (context.req.method === "GET" || context.req.method === "POST")) ||
      (path === OWNER_AUTH_PATHS.status && context.req.method === "GET") ||
      ((path === OWNER_AUTH_PATHS.login || path === OWNER_AUTH_PATHS.logout) &&
        context.req.method === "POST")
    )
      return next();
    if (
      path.startsWith("/internal/") &&
      path !== "/internal/hosts/enroll-key" &&
      path !== "/internal/server-move/pending"
    )
      return next();
    if (
      (path === "/install.sh" || path === "/install.ps1") &&
      context.req.method === "GET" &&
      context.req.header("X-BB-Enrollment")
    )
      return next();
    const hostKey = context.req.header(HOST_API_AUTH_HEADER);
    if (
      path !== "/internal/server-move/pending" &&
      hostKey !== undefined &&
      hostKey.length <= 1024
    ) {
      const verified = await deps.machineAuth.verifyDaemonHostKey(hostKey);
      if (
        verified !== null &&
        getNonDestroyedHost(deps.db, verified.metadata.hostId) !== null
      ) {
        if (isPluginAdministrationRequest(path, context.req.method)) {
          return context.json(
            {
              code: "machine_plugin_management_forbidden",
              message:
                "Machine credentials cannot manage server plugins or marketplaces",
            },
            403,
          );
        }
        context.req.raw.headers.set("x-bb-gate-auth", "machine");
        context.req.raw.headers.set(
          "x-bb-gate-machine-id",
          verified.metadata.hostId,
        );
        return next();
      }
    }
    if (authenticated(context)) return next();
    const pluginToken = context.req.header(PLUGIN_RPC_CALLER_HEADER);
    if (pluginToken !== undefined && pluginToken.length <= 1024) {
      const caller = resolvePluginCaller(pluginToken);
      if (caller.ok && caller.caller.kind === "plugin") return next();
    }
    if (
      context.req.method === "GET" &&
      context.req.header("upgrade")?.toLowerCase() !== "websocket" &&
      !path.startsWith("/api/") &&
      !path.startsWith("/internal/") &&
      !path.startsWith("/ws") &&
      context.req.header("accept")?.includes("text/html")
    ) {
      return context.redirect("/auth/login", 303);
    }
    return unauthorized(context);
  });

  app.get(OWNER_AUTH_PATHS.status, (context) =>
    context.json(status(context), 200, { "cache-control": "no-store" }),
  );
  app.get("/auth/login", (context) => {
    if (!enabled || authenticated(context)) return context.redirect("/", 303);
    return loginHtml(context, false);
  });
  const login = async (context: Context): Promise<Response> => {
    if (!enabled || !checkOrigin(context)) return unauthorized(context);
    const now = Date.now();
    for (const [key, attempt] of attempts)
      if (attempt.expiresAt <= now) attempts.delete(key);
    const key = getTrustedRemoteAddress(context) ?? "unknown";
    const attempt = attempts.get(key);
    if (globalWindow.expiresAt <= now)
      globalWindow = { count: 0, expiresAt: now + 60_000 };
    if (
      (attempt?.count ?? 0) >= 5 ||
      globalWindow.count >= 100 ||
      activeLogins >= 4 ||
      (!attempts.has(key) && attempts.size >= 1024)
    ) {
      return context.json(
        { code: "too_many_requests", message: "Try again later" },
        429,
        { "retry-after": "60" },
      );
    }
    attempts.set(key, {
      count: (attempt?.count ?? 0) + 1,
      expiresAt: attempt?.expiresAt ?? now + 60_000,
    });
    globalWindow.count += 1;
    activeLogins += 1;
    try {
      const payload = await readLogin(context);
      const credentials = readLocalServerOwnerCredentials(deps.config.dataDir);
      if (
        payload === null ||
        !(await verifyServerOwnerPassword(
          credentials,
          payload.username,
          payload.password,
        ))
      )
        return unauthorized(context);
      attempts.delete(key);
      setCookie(
        context,
        SERVER_OWNER_COOKIE_NAME,
        createServerOwnerSession(credentials),
        { ...cookieOptions, maxAge: SERVER_OWNER_SESSION_SECONDS },
      );
      context.header("cache-control", "no-store");
      return context.req.path === "/auth/login"
        ? context.redirect("/", 303)
        : context.json({ enabled: true, authenticated: true });
    } finally {
      activeLogins -= 1;
    }
  };
  app.post("/auth/login", login);
  app.post(OWNER_AUTH_PATHS.login, login);
  app.post(OWNER_AUTH_PATHS.logout, (context) => {
    if (!checkOrigin(context)) return unauthorized(context);
    deleteCookie(context, SERVER_OWNER_COOKIE_NAME, cookieOptions);
    return context.json({ enabled, authenticated: false }, 200, {
      "cache-control": "no-store",
    });
  });
  const sockets = new Set<{ check(): boolean; close(): void }>();
  let interval: ReturnType<typeof setInterval> | null = null;
  function stopUnusedInterval(): void {
    if (sockets.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }
  function revokeInvalidSockets(): void {
    for (const socket of sockets) {
      if (!socket.check()) {
        sockets.delete(socket);
        socket.close();
      }
    }
    stopUnusedInterval();
  }
  return {
    guardWebSocket(context, events) {
      const token = getCookie(context, SERVER_OWNER_COOKIE_NAME);
      if (
        !enabled ||
        token === undefined ||
        context.req.header("x-bb-gate-auth") === "machine"
      )
        return events;
      const check = (): boolean => {
        try {
          return (
            verifyServerOwnerSession(
              readLocalServerOwnerCredentials(deps.config.dataDir),
              token,
            ) !== null
          );
        } catch {
          return false;
        }
      };
      let tracked: { check(): boolean; close(): void } | null = null;
      return {
        ...events,
        onOpen(event, socket) {
          if (!check()) {
            socket.close(1008, "Owner session expired");
            return;
          }
          tracked = {
            check,
            close: () => socket.close(1008, "Owner session expired"),
          };
          sockets.add(tracked);
          if (interval === null) {
            interval = setInterval(revokeInvalidSockets, 1000);
            interval.unref();
          }
          events.onOpen?.(event, socket);
        },
        onMessage(event, socket) {
          if (!check()) {
            socket.close(1008, "Owner session expired");
            return;
          }
          events.onMessage?.(event, socket);
        },
        onClose(event, socket) {
          if (tracked !== null) sockets.delete(tracked);
          stopUnusedInterval();
          events.onClose?.(event, socket);
        },
      };
    },
    dispose() {
      if (interval !== null) clearInterval(interval);
      interval = null;
      sockets.clear();
    },
  };
}

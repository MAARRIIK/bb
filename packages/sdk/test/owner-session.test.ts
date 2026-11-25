import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { createNodeBbSdk } from "../src/node.js";
import { createNodeWebsocketFactory } from "../src/node-websocket.js";
import {
  createOwnerSessionFetch,
  type OwnerSessionCookie,
} from "../src/owner-session-fetch.js";

describe("owner session transport", () => {
  it("uses the authenticated cookie for the real Node WebSocket handshake", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing WebSocket address");
    const origin = `http://127.0.0.1:${address.port}`;
    const transport = createOwnerSessionFetch({
      baseUrl: origin,
      session: { origin, cookie: "bb_owner_session=private.signature" },
      fetch,
    });
    try {
      const connected = once(server, "connection");
      const socket = createNodeWebsocketFactory(transport.getCookie)(
        origin.replace("http:", "ws:") + "/ws",
      );
      await new Promise<void>((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () =>
          reject(new Error("Authenticated WebSocket failed"));
      });
      const [_peer, request] = await connected;
      expect(request.headers.cookie).toBe("bb_owner_session=private.signature");
      socket.close();
    } finally {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("rejects password and session transmission over public plain HTTP before making a request", async () => {
    let requests = 0;
    const sdk = createNodeBbSdk({
      baseUrl: "http://public.example",
      fetch: async () => {
        requests += 1;
        return new Response();
      },
    });
    await expect(
      sdk.experimental_ownerAuth.login({
        username: "owner",
        password: "private password",
      }),
    ).rejects.toThrow("requires HTTPS");
    expect(() =>
      createNodeBbSdk({
        baseUrl: "http://public.example",
        ownerSession: {
          origin: "http://public.example",
          cookie: "bb_owner_session=private.signature",
        },
      }),
    ).toThrow("requires HTTPS");
    expect(requests).toBe(0);
  });
  it("persists a login for independent SDK clients and clears it on logout", async () => {
    const received: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      received.push(request.headers.cookie);
      response.setHeader("content-type", "application/json");
      if (request.url?.endsWith("/login")) {
        response.setHeader(
          "set-cookie",
          "bb_owner_session=payload.signature; HttpOnly; SameSite=Strict; Path=/",
        );
        response.end(JSON.stringify({ enabled: true, authenticated: true }));
      } else if (request.url?.endsWith("/logout")) {
        response.setHeader(
          "set-cookie",
          "bb_owner_session=; Max-Age=0; Path=/",
        );
        response.end(JSON.stringify({ enabled: true, authenticated: false }));
      } else {
        response.end(
          JSON.stringify({
            enabled: true,
            authenticated:
              request.headers.cookie === "bb_owner_session=payload.signature",
          }),
        );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing HTTP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let saved: OwnerSessionCookie | null = null;
    try {
      const first = createNodeBbSdk({
        baseUrl,
        onOwnerSessionChange: (session) => {
          saved = session;
        },
      });
      expect(await first.experimental_ownerAuth.status()).toEqual({
        enabled: true,
        authenticated: false,
      });
      await first.experimental_ownerAuth.login({
        username: "owner",
        password: "private password",
      });
      expect(saved).toEqual({
        origin: baseUrl,
        cookie: "bb_owner_session=payload.signature",
      });
      const second = createNodeBbSdk({
        baseUrl,
        ownerSession: saved ?? undefined,
        onOwnerSessionChange: (session) => {
          saved = session;
        },
      });
      expect(await second.experimental_ownerAuth.status()).toEqual({
        enabled: true,
        authenticated: true,
      });
      await second.experimental_ownerAuth.logout();
      expect(saved).toBeNull();
      expect(await second.experimental_ownerAuth.status()).toEqual({
        enabled: true,
        authenticated: false,
      });
      expect(received).toEqual([
        undefined,
        undefined,
        "bb_owner_session=payload.signature",
        "bb_owner_session=payload.signature",
        undefined,
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("scopes HTTP and WebSocket credentials to the configured origin and rejects redirects", async () => {
    const requests: Array<{
      url: string;
      cookie: string | null;
      redirect: RequestRedirect | undefined;
    }> = [];
    const transport = createOwnerSessionFetch({
      baseUrl: "https://ai.example",
      session: {
        origin: "https://ai.example",
        cookie: "bb_owner_session=private.signature",
      },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          cookie: new Headers(init?.headers).get("cookie"),
          redirect: init?.redirect,
        });
        return new Response(null, {
          headers: {
            "set-cookie": "bb_owner_session=foreign.signature; Path=/",
          },
        });
      },
    });
    await transport.fetch("https://other.example/api/v1/projects");
    expect(transport.getCookie("wss://ai.example/ws")).toBe(
      "bb_owner_session=private.signature",
    );
    expect(transport.getCookie("wss://other.example/ws")).toBeNull();
    expect(transport.getCookie("ws://ai.example/ws")).toBeNull();
    await transport.fetch("https://ai.example/api/v1/projects");
    expect(requests).toEqual([
      {
        url: "https://other.example/api/v1/projects",
        cookie: null,
        redirect: undefined,
      },
      {
        url: "https://ai.example/api/v1/projects",
        cookie: "bb_owner_session=private.signature",
        redirect: "error",
      },
    ]);
    const anonymous = createOwnerSessionFetch({
      baseUrl: "https://ai.example",
      fetch: async (_input, init) => {
        expect(init?.redirect).toBe("error");
        return new Response(null);
      },
    });
    await anonymous.fetch("https://ai.example/api/v1/owner-auth/login", {
      method: "POST",
      body: "private password",
    });
  });
});

import type { FetchImplementation } from "./response.js";
import { assertOwnerAuthUrl } from "./owner-auth-url.js";

export interface OwnerSessionCookie {
  origin: string;
  cookie: string;
}

export function createOwnerSessionFetch(args: {
  baseUrl: string;
  fetch: FetchImplementation;
  session?: OwnerSessionCookie;
  onChange?: (session: OwnerSessionCookie | null) => void;
}) {
  const origin = new URL(args.baseUrl).origin;
  let cookie = args.session?.origin === origin ? args.session.cookie : null;
  if (cookie !== null) assertOwnerAuthUrl(origin);
  function getCookie(url: string): string | null {
    const target = new URL(url);
    if (target.protocol === "ws:") target.protocol = "http:";
    if (target.protocol === "wss:") target.protocol = "https:";
    return target.origin === origin ? cookie : null;
  }
  const authenticatedFetch: FetchImplementation = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const saved = getCookie(url);
    if (saved !== null) headers.set("cookie", saved);
    const response = await args.fetch(input, {
      ...init,
      headers,
      ...(saved !== null || new URL(url).pathname === "/api/v1/owner-auth/login"
        ? { redirect: "error" as const }
        : {}),
    });
    if (
      new URL(url).origin === origin &&
      (!response.url || new URL(response.url).origin === origin)
    ) {
      for (const value of response.headers.getSetCookie()) {
        const match =
          /^(bb_owner_session)=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|)(?:;|$)/u.exec(
            value,
          );
        if (!match) continue;
        if (match[2]) assertOwnerAuthUrl(origin);
        cookie = match[2] ? `${match[1]}=${match[2]}` : null;
        args.onChange?.(cookie === null ? null : { origin, cookie });
      }
    }
    return response;
  };
  return { fetch: authenticatedFetch, getCookie };
}

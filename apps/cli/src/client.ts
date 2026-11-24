import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import {
  CALLER_THREAD_HEADER_NAME,
  CLI_REQUEST_HEADER_NAME,
  CLIENT_LANGUAGE_HEADER_NAME,
} from "@bb/config/app-surface";
import { resolveInterfaceLanguage } from "@bb/domain";
import type { Dispatcher } from "undici";
import { resolveContextThreadId } from "./context-env.js";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, init);
}

function cliSdkFetch(timeoutMs: number | undefined): typeof cliFetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(CLI_REQUEST_HEADER_NAME, "1");
    const callerThreadId = resolveContextThreadId();
    if (callerThreadId !== undefined) {
      headers.set(CALLER_THREAD_HEADER_NAME, callerThreadId);
    } else {
      const locale =
        process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
      const languages = locale === undefined ? [] : [locale.split(/[.@]/)[0]!];
      headers.set(
        CLIENT_LANGUAGE_HEADER_NAME,
        resolveInterfaceLanguage("system", languages),
      );
    }
    if (timeoutMs === undefined) return cliFetch(input, { ...init, headers });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return cliFetch(input, {
      ...init,
      headers,
      signal: init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal,
    });
  };
}

export function createCliBbSdk(baseUrl: string, timeoutMs?: number): BbSdk {
  return createNodeBbSdk({ baseUrl, fetch: cliSdkFetch(timeoutMs) });
}

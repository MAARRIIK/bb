import {
  OWNER_AUTH_PATHS,
  ownerAuthLoginSchema,
  ownerAuthStatusSchema,
  type OwnerAuthLogin,
  type OwnerAuthStatus,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";
import { assertOwnerAuthUrl } from "../owner-auth-url.js";

export interface ExperimentalOwnerAuthArea {
  status(): Promise<OwnerAuthStatus>;
  login(input: OwnerAuthLogin): Promise<OwnerAuthStatus>;
  logout(): Promise<OwnerAuthStatus>;
}

export function createOwnerAuthArea({
  transport,
}: CreateSdkAreaArgs): ExperimentalOwnerAuthArea {
  async function request(
    path: string,
    input: OwnerAuthLogin | null,
    method: "GET" | "POST",
  ) {
    if (input !== null) assertOwnerAuthUrl(transport.baseUrl || "/");
    const response = await transport.resolve(
      transport.fetch(`${transport.baseUrl.replace(/\/+$/u, "")}${path}`, {
        method,
        headers:
          method === "POST" ? { "content-type": "application/json" } : {},
        ...(input === null
          ? {}
          : { body: JSON.stringify(ownerAuthLoginSchema.parse(input)) }),
      }),
    );
    const body: unknown = await response.json();
    return ownerAuthStatusSchema.parse(body);
  }
  return {
    status: () => request(OWNER_AUTH_PATHS.status, null, "GET"),
    login: (input) => request(OWNER_AUTH_PATHS.login, input, "POST"),
    logout: () => request(OWNER_AUTH_PATHS.logout, null, "POST"),
  };
}

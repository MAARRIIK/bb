import type { ProviderSessionSource } from "@bb/domain";
import { ApiError } from "../errors.js";

export function isCurrentProviderSession(
  thread: ProviderSessionSource,
  source: ProviderSessionSource | null,
): boolean {
  return source === null
    ? thread.providerSessionId === null
    : source.providerId === thread.providerId &&
        source.providerSessionId === thread.providerSessionId;
}

export function requireCurrentProviderSession(
  thread: ProviderSessionSource,
  source: ProviderSessionSource | null,
): void {
  if (!isCurrentProviderSession(thread, source)) {
    throw new ApiError(
      409,
      "invalid_request",
      "Provider session has changed; this request is no longer current",
    );
  }
}

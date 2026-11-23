import type { ProviderSessionSource } from "@bb/domain";
import { ApiError } from "../errors.js";

export function requireCurrentProviderSession(
  thread: ProviderSessionSource,
  source: ProviderSessionSource | null,
): void {
  if (source === null && thread.providerSessionId === null) return;
  if (
    source === null ||
    source.providerId !== thread.providerId ||
    source.providerSessionId !== thread.providerSessionId
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Provider session has changed; this request is no longer current",
    );
  }
}

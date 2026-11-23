import type { ProviderSessionSource } from "@bb/domain";
import { CommandDispatchError } from "./command-dispatch-support.js";

export function requireMatchingProviderSession(
  current: ProviderSessionSource | null,
  expected: ProviderSessionSource | null,
): void {
  if (
    current !== null &&
    expected === null &&
    current.providerSessionId === null
  )
    return;
  if (
    !current ||
    !expected ||
    current.providerId !== expected.providerId ||
    current.providerSessionId !== expected.providerSessionId
  ) {
    throw new CommandDispatchError(
      "provider_session_mismatch",
      "Thread command belongs to another provider session",
    );
  }
}

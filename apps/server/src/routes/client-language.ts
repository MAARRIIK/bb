import { CLIENT_LANGUAGE_HEADER_NAME } from "@bb/config/app-surface";
import {
  resolvedInterfaceLanguageSchema,
  type ResolvedInterfaceLanguage,
} from "@bb/domain";
import { ApiError } from "../errors.js";

export function requestClientLanguage(
  headers: Headers,
  requested: ResolvedInterfaceLanguage | null | undefined,
): ResolvedInterfaceLanguage | null | undefined {
  if (requested !== undefined) return requested;
  const value = headers.get(CLIENT_LANGUAGE_HEADER_NAME);
  if (value === null) return undefined;
  const parsed = resolvedInterfaceLanguageSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "Client language must be en or ru",
    );
  }
  return parsed.data;
}

import { PROVIDER_ID_PATTERN } from "../shared/contract";
import { BUILTIN_PROVIDER_IDS } from "../shared/builtin-icons";

export const IDS_KEY = "agent-icons:assigned-ids";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCachedIds(): string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(IDS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === "string" && PROVIDER_ID_PATTERN.test(id));
  } catch {
    return [];
  }
}

export function writeCachedIds(ids: readonly string[]): void {
  const next = JSON.stringify([...new Set(ids)].filter((id) => PROVIDER_ID_PATTERN.test(id)).sort());
  try {
    const store = storage();
    if (store && store.getItem(IDS_KEY) !== next) store.setItem(IDS_KEY, next);
  } catch {
  }
}

export function idsToRegister(): string[] {
  return [...new Set<string>([...BUILTIN_PROVIDER_IDS, ...readCachedIds()])];
}

let registeredAtSetup: ReadonlySet<string> = new Set();

export function captureRegisteredIds(): string[] {
  const ids = idsToRegister();
  registeredAtSetup = new Set(ids);
  return ids;
}

export function isRegisteredAtSetup(providerId: string): boolean {
  return registeredAtSetup.has(providerId);
}

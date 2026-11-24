export type Json = Record<string, unknown>;

export function record(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function oneLine(value: string, max = 90): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : "—";
}

export interface ThreadInfo {
  id: string;
  title: string;
  projectId: string | null;
  providerId: string | null;
  parentThreadId: string | null;
}

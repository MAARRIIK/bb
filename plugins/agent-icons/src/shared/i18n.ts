import { MAX_FILE_BYTES } from "./limits";

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "en";

export const LANGUAGE_LABELS: Record<Language, string> = { en: "English", ru: "Русский" };

export function parseLanguage(value: unknown): Language {
  return (LANGUAGES as readonly unknown[]).includes(value) ? (value as Language) : DEFAULT_LANGUAGE;
}

export function formatMegabytes(bytes: number, language: Language): string {
  const value = (bytes / (1024 * 1024)).toFixed(1);
  return language === "ru" ? value.replace(".", ",") : value;
}

const tooLarge: Record<Language, (limitKb: number, sizeKb: number) => string> = {
  en: (limitKb, sizeKb) => `file larger than ${limitKb} KB (${sizeKb} KB)`,
  ru: (limitKb, sizeKb) => `файл больше ${limitKb} КБ (${sizeKb} КБ)`,
};

export function tooLargeReason(size: number, language: Language): string {
  return tooLarge[language](MAX_FILE_BYTES / 1024, Math.ceil(size / 1024));
}

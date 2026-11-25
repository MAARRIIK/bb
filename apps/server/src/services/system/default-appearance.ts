import { insertStoredAppearanceIfMissing, type DbConnection } from "@bb/db";
import { defaultFaviconColor } from "@bb/domain";

export function seedDefaultAppearance(db: DbConnection): void {
  insertStoredAppearanceIfMissing(db, {
    themeId: "plugin:codex-theme:codex",
    faviconColor: defaultFaviconColor,
    updatedAt: Date.now(),
  });
}

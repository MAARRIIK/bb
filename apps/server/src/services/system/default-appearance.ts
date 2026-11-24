import { appTheme, type DbConnection } from "@bb/db";
import { defaultFaviconColor } from "@bb/domain";

export function seedDefaultAppearance(db: DbConnection): void {
  db.insert(appTheme)
    .values({
      id: "current",
      themeId: "plugin:codex-theme:codex",
      faviconColor: defaultFaviconColor,
      updatedAt: Date.now(),
    })
    .onConflictDoNothing({ target: appTheme.id })
    .run();
}

import { appTheme, getStoredThemeId, setStoredAppearance } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { describe, expect, it } from "vitest";
import { seedDefaultAppearance } from "../../src/services/system/default-appearance.js";

describe("default appearance at startup", () => {
  it("seeds a fresh profile once and preserves later changes on restart", () => {
    const db = createMigratedConnection();
    try {
      seedDefaultAppearance(db);
      expect(getStoredThemeId(db)).toBe("plugin:codex-theme:codex");
      const first = db.select().from(appTheme).get();
      seedDefaultAppearance(db);
      expect(db.select().from(appTheme).get()).toEqual(first);

      setStoredAppearance(db, { themeId: "default", faviconColor: "default" });
      seedDefaultAppearance(db);
      expect(getStoredThemeId(db)).toBe("default");

      setStoredAppearance(db, { themeId: "custom", faviconColor: "default" });
      seedDefaultAppearance(db);
      expect(getStoredThemeId(db)).toBe("custom");
    } finally {
      db.$client.close();
    }
  });
});

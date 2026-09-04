import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "./uiStore";
import {
  migratePersistedAppState,
  resolvePersistedEmbeddingConsent,
  resolvePersistedShortcuts,
} from "./persistMigrations";
import { findDefaultShortcutEditorConflicts } from "../utils/shortcutEditorConflict";

vi.mock("../utils/shortcuts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/shortcuts")>();
  return {
    ...actual,
    isMacPlatform: () => true,
    getPreferredShortcutModifierToken: () => "Cmd" as const,
    normalizeShortcutForPlatform: (shortcut: string) => shortcut,
    normalizeShortcutConfigForPlatform: <T extends Record<string, string>>(
      shortcuts: T,
    ) => shortcuts,
  };
});

describe("resolvePersistedShortcuts shortcut default migration", () => {
  it("将旧默认快捷键替换为新默认", () => {
    const shortcuts = resolvePersistedShortcuts({
      shortcuts: {
        openKnowledgeBase: "Cmd+Shift+K",
        locateCurrentFile: "Cmd+Shift+L",
        exportPdf: "Cmd+Shift+H",
      },
    });

    expect(shortcuts.openKnowledgeBase).toBe(
      defaultSettings.shortcuts.openKnowledgeBase,
    );
    expect(shortcuts.locateCurrentFile).toBe(
      defaultSettings.shortcuts.locateCurrentFile,
    );
    expect(shortcuts.exportPdf).toBe(defaultSettings.shortcuts.exportPdf);
  });

  it("保留用户自定义快捷键", () => {
    const shortcuts = resolvePersistedShortcuts({
      shortcuts: {
        openKnowledgeBase: "Alt+Shift+9",
        locateCurrentFile: "Alt+Shift+8",
        exportPdf: "Alt+Shift+7",
      },
    });

    expect(shortcuts.openKnowledgeBase).toBe("Alt+Shift+9");
    expect(shortcuts.locateCurrentFile).toBe("Alt+Shift+8");
    expect(shortcuts.exportPdf).toBe("Alt+Shift+7");
  });

  it("缺省字段补齐为当前默认值", () => {
    const shortcuts = resolvePersistedShortcuts({
      shortcuts: { save: "Ctrl+S" },
    });

    expect(shortcuts.openKnowledgeBase).toBe(
      defaultSettings.shortcuts.openKnowledgeBase,
    );
    expect(shortcuts.locateCurrentFile).toBe(
      defaultSettings.shortcuts.locateCurrentFile,
    );
    expect(shortcuts.exportPdf).toBe(defaultSettings.shortcuts.exportPdf);
    expect(shortcuts.commandPalette).toBe(
      defaultSettings.shortcuts.commandPalette,
    );
  });
});

describe("migratePersistedAppState", () => {
  it("version 0 会迁移旧默认快捷键并补齐同意字段", () => {
    const migrated = migratePersistedAppState(
      {
        settings: {
          shortcuts: { openKnowledgeBase: "Cmd+Shift+K" },
        },
      },
      0,
    ) as { settings: { shortcuts: { openKnowledgeBase: string } } };

    expect(migrated.settings.shortcuts.openKnowledgeBase).toBe(
      defaultSettings.shortcuts.openKnowledgeBase,
    );
    expect(resolvePersistedEmbeddingConsent(undefined)).toBe("unknown");
  });
});

describe("default global shortcuts vs editor keymap", () => {
  it("默认全局快捷键与编辑器 keymap 无冲突", () => {
    expect(findDefaultShortcutEditorConflicts()).toEqual([]);
  });
});

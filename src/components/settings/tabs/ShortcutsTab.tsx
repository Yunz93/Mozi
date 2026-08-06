import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, ShortcutConfig } from "../../../types";
import { useI18n } from "../../../hooks/useI18n";
import type { TranslationKey } from "../../../utils/i18n";
import {
  formatShortcutForDisplay,
  normalizeShortcutForPlatform,
  shortcutFromKeyboardEvent,
  uniqueFormattedShortcuts,
} from "../../../utils/shortcuts";
import { setShortcutCaptureActive } from "../../../utils/shortcutCaptureGate";
import type { SettingsTabProps } from "../types";

type ShortcutGroupId = "workspace" | "editing" | "search" | "panels";

interface ShortcutItemConfig {
  id: string;
  label: string;
  description: string;
  editable?: boolean;
  settingKey?: keyof AppSettings["shortcuts"];
  shortcuts?: string[];
}

interface ShortcutGroupConfig {
  id: ShortcutGroupId;
  label: string;
  description: string;
  items: ShortcutItemConfig[];
}

function getShortcutGroups(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): ShortcutGroupConfig[] {
  return [
    {
      id: "workspace",
      label: t("settings_workspace"),
      description: t("settings_workspaceDesc"),
      items: [
        {
          id: "save",
          label: t("settings_saveFile"),
          description: t("settings_saveFileDesc"),
          editable: true,
          settingKey: "save",
        },
        {
          id: "toggleView",
          label: t("settings_toggleView"),
          description: t("settings_toggleViewDesc"),
          editable: true,
          settingKey: "toggleView",
        },
        {
          id: "toggleOutline",
          label: t("settings_toggleOutline"),
          description: t("settings_toggleOutlineDesc"),
          editable: true,
          settingKey: "toggleOutline",
        },
        {
          id: "toggleSidebar",
          label: t("settings_toggleSidebar"),
          description: t("settings_toggleSidebarDesc"),
          editable: true,
          settingKey: "toggleSidebar",
        },
        {
          id: "openKnowledgeBase",
          label: t("settings_openKnowledgeBase"),
          description: t("settings_openKnowledgeBaseDesc"),
          editable: true,
          settingKey: "openKnowledgeBase",
        },
        {
          id: "locateCurrentFile",
          label: t("settings_locateCurrentFile"),
          description: t("settings_locateCurrentFileDesc"),
          editable: true,
          settingKey: "locateCurrentFile",
        },
        {
          id: "openSettings",
          label: t("settings_openSettings"),
          description: t("settings_openSettingsDesc"),
          editable: true,
          settingKey: "settings",
        },
        {
          id: "toggleTheme",
          label: t("settings_toggleTheme"),
          description: t("settings_toggleThemeDesc"),
          editable: true,
          settingKey: "toggleTheme",
        },
        {
          id: "zoomUiIn",
          label: t("settings_zoomUiIn"),
          description: t("settings_zoomUiInDesc"),
          shortcuts: ["Cmd+=", "Cmd+Shift+="],
        },
        {
          id: "zoomUiOut",
          label: t("settings_zoomUiOut"),
          description: t("settings_zoomUiOutDesc"),
          // One chord is enough: Cmd/Ctrl are normalized for display.
          shortcuts: ["Cmd+-"],
        },
        {
          id: "zoomUiReset",
          label: t("settings_zoomUiReset"),
          description: t("settings_zoomUiResetDesc"),
          shortcuts: ["Cmd+Shift+0"],
        },
      ],
    },
    {
      id: "editing",
      label: t("settings_editing"),
      description: t("settings_editingDesc"),
      items: [
        {
          id: "newNote",
          label: t("settings_newNote"),
          description: t("settings_newNoteDesc"),
          editable: true,
          settingKey: "newNote",
        },
        {
          id: "newFolder",
          label: t("settings_newFolder"),
          description: t("settings_newFolderDesc"),
          editable: true,
          settingKey: "newFolder",
        },
        {
          id: "closeTab",
          label: t("settings_closeTab"),
          description: t("settings_closeTabDesc"),
          editable: true,
          settingKey: "closeTab",
        },
        {
          id: "aiAnalyze",
          label: t("settings_aiEnhance"),
          description: t("settings_aiEnhanceDesc"),
          editable: true,
          settingKey: "aiAnalyze",
        },
        {
          id: "undo",
          label: t("settings_undo"),
          description: t("settings_undoDesc"),
          shortcuts: ["Ctrl+Z"],
        },
        {
          id: "redo",
          label: t("settings_redo"),
          description: t("settings_redoDesc"),
          shortcuts: ["Ctrl+Shift+Z"],
        },
      ],
    },
    {
      id: "search",
      label: t("settings_search"),
      description: t("settings_searchDesc"),
      items: [
        {
          id: "search",
          label: t("settings_openSearch"),
          description: t("settings_openSearchDesc"),
          editable: true,
          settingKey: "search",
        },
        {
          id: "sidebarSearch",
          label: t("settings_sidebarSearch"),
          description: t("settings_sidebarSearchDesc"),
          editable: true,
          settingKey: "sidebarSearch",
        },
        {
          id: "nextMatch",
          label: t("settings_nextMatch"),
          description: t("settings_nextMatchDesc"),
          shortcuts: ["Enter"],
        },
        {
          id: "previousMatch",
          label: t("settings_previousMatch"),
          description: t("settings_previousMatchDesc"),
          shortcuts: ["Shift+Enter"],
        },
      ],
    },
    {
      id: "panels",
      label: t("settings_panelsAndDialogs"),
      description: t("settings_panelsAndDialogsDesc"),
      items: [
        {
          id: "closePanel",
          label: t("settings_closeActivePanel"),
          description: t("settings_closeActivePanelDesc"),
          shortcuts: ["Escape"],
        },
        {
          id: "exportPdf",
          label: t("settings_exportPdf"),
          description: t("settings_exportPdfDesc"),
          editable: true,
          settingKey: "exportPdf",
        },
        {
          id: "cleanupUnusedAttachments",
          label: t("settings_cleanupUnusedAttachments"),
          description: t("settings_cleanupUnusedAttachmentsDesc"),
          shortcuts: ["Cmd+Shift+-"],
        },
      ],
    },
  ];
}

function getShortcutLabels(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): Record<string, string> {
  return {
    save: t("settings_saveFile"),
    toggleView: t("settings_toggleView"),
    aiAnalyze: t("settings_aiEnhance"),
    search: t("settings_search"),
    sidebarSearch: t("settings_sidebarSearch"),
    locateCurrentFile: t("settings_locateCurrentFile"),
    settings: t("settings_openSettings"),
    toggleOutline: t("settings_toggleOutline"),
    toggleSidebar: t("settings_toggleSidebar"),
    toggleTheme: t("settings_toggleTheme"),
    newNote: t("settings_newNote"),
    newFolder: t("settings_newFolder"),
    closeTab: t("settings_closeTab"),
    openKnowledgeBase: t("settings_openKnowledgeBase"),
    exportPdf: t("settings_exportPdf"),
  };
}

export const ShortcutsTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useI18n();
  const shortcutLabels = getShortcutLabels(t);
  const shortcutGroups = getShortcutGroups(t);
  const [expandedShortcutGroups, setExpandedShortcutGroups] = useState<
    Record<ShortcutGroupId, boolean>
  >({
    workspace: true,
    editing: true,
    search: true,
    panels: true,
  });
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutConfig | null>(
    null,
  );
  const [conflictWith, setConflictWith] = useState<keyof ShortcutConfig | null>(
    null,
  );
  const shortcutsRef = useRef(settings.shortcuts);
  shortcutsRef.current = settings.shortcuts;

  const toggleRecorder = useCallback((settingKey: keyof ShortcutConfig) => {
    setConflictWith(null);
    setRecordingKey((prev) => (prev === settingKey ? null : settingKey));
  }, []);

  useEffect(() => {
    if (!recordingKey) {
      setShortcutCaptureActive(false);
      return;
    }

    setShortcutCaptureActive(true);
    const capturedSettingKey = recordingKey;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.key === "Escape") {
        setShortcutCaptureActive(false);
        setRecordingKey(null);
        return;
      }

      const serialized = shortcutFromKeyboardEvent(event);
      if (!serialized) return;

      // Reject chords already bound to another action so two actions can
      // never silently share one shortcut. Keep recording so the user can
      // immediately try a different combination.
      const conflictingKey = (
        Object.entries(shortcutsRef.current) as Array<
          [keyof ShortcutConfig, string]
        >
      ).find(
        ([key, value]) =>
          key !== capturedSettingKey &&
          normalizeShortcutForPlatform(value) === serialized,
      )?.[0];
      if (conflictingKey) {
        setConflictWith(conflictingKey);
        return;
      }

      setConflictWith(null);
      setShortcutCaptureActive(false);
      onUpdateSettings({
        shortcuts: {
          ...shortcutsRef.current,
          [capturedSettingKey]: serialized,
        },
      });
      setRecordingKey(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      setShortcutCaptureActive(false);
    };
  }, [recordingKey, onUpdateSettings]);

  const toggleShortcutGroup = (groupId: ShortcutGroupId) => {
    setExpandedShortcutGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  return (
    <div className="space-y-6 animate-fade-in-02s">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
          {t("settings_shortcutsTitle")}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {t("settings_shortcutsIntro")}
        </p>

        <div className="space-y-3">
          {shortcutGroups.map((group) => {
            const isExpanded = expandedShortcutGroups[group.id];
            return (
              <section
                key={group.id}
                className="rounded-2xl border border-gray-200/70 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.04] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleShortcutGroup(group.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {group.label}
                      </h4>
                      <span className="inline-flex items-center rounded-full bg-white/80 dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        {group.items.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {group.description}
                    </p>
                  </div>
                  <svg
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200/70 dark:border-white/10 px-4 py-3">
                    <div className="space-y-2.5">
                      {group.items.map((item) => {
                        const editableValue = item.settingKey
                          ? settings.shortcuts[item.settingKey]
                          : "";
                        const itemShortcuts = item.editable
                          ? [editableValue]
                          : (item.shortcuts ?? []);
                        const isRecording = Boolean(
                          item.settingKey && recordingKey === item.settingKey,
                        );

                        return (
                          <div
                            key={item.id}
                            className="flex items-start justify-between gap-4 rounded-xl bg-white/85 dark:bg-black/20 px-3 py-3 border border-gray-100 dark:border-white/5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                                  {item.label}
                                </span>
                                {item.editable && (
                                  <span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    {t("settings_shortcutRecordHint")}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                                {item.description}
                              </p>
                            </div>

                            {item.editable && item.settingKey ? (
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleRecorder(item.settingKey!)
                                  }
                                  aria-pressed={isRecording}
                                  aria-label={
                                    shortcutLabels[item.settingKey] ||
                                    item.label
                                  }
                                  className={`min-w-[7.5rem] rounded-lg border px-2.5 py-1.5 text-center font-mono text-xs outline-none transition-colors ${
                                    isRecording
                                      ? "border-accent-DEFAULT bg-accent-DEFAULT/10 text-gray-900 dark:text-white ring-2 ring-accent-DEFAULT/30"
                                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-gray-700 dark:text-gray-200 hover:border-accent-DEFAULT/60 focus-visible:border-accent-DEFAULT"
                                  }`}
                                >
                                  {isRecording
                                    ? t("settings_shortcutListening")
                                    : formatShortcutForDisplay(editableValue)}
                                </button>
                                {isRecording && conflictWith && (
                                  <span className="max-w-[13rem] text-right text-[10px] text-red-500 dark:text-red-400">
                                    {t("settings_shortcutConflict", {
                                      label:
                                        shortcutLabels[conflictWith] ??
                                        conflictWith,
                                    })}
                                  </span>
                                )}
                                {isRecording && (
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                    {t("settings_shortcutEscToCancel")}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex shrink-0 flex-wrap justify-end gap-1.5 max-w-[180px]">
                                {uniqueFormattedShortcuts(itemShortcuts).map(
                                  (shortcut) => (
                                    <span
                                      key={shortcut}
                                      className="inline-flex items-center rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-2 py-1 text-[11px] font-mono text-gray-600 dark:text-gray-300"
                                    >
                                      {shortcut}
                                    </span>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

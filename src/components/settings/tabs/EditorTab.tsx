import React from "react";
import type { AppSettings } from "../../../types";
import { ViewMode } from "../../../types";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_PREVIEW_FONT_FAMILY,
  getResolvedCodeFontFamily,
  getResolvedEditorFontFamily,
  getResolvedPreviewFontFamily,
} from "../../../utils/fontSettings";
import { normalizeAttachmentLocation } from "../../../utils/attachmentLocation";
import {
  normalizeDefaultViewMode,
  normalizeTabSize,
} from "../../../utils/editorPreferences";
import { normalizeNewNoteLocation } from "../../../utils/newNoteLocation";
import { useI18n } from "../../../hooks/useI18n";
import type { TranslationKey } from "../../../utils/i18n";
import type { SettingsTabProps } from "../types";
import { useFontOptions } from "../useFontOptions";
import { SettingsSelect } from "../SettingsSelect";

function formatAutoSaveInterval(
  intervalMs: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (intervalMs < 60000) {
    return t("settings_seconds", { count: Math.round(intervalMs / 1000) });
  }
  const minutes = intervalMs / 60000;
  return t("settings_minutes", {
    count: Number.isInteger(minutes) ? minutes : minutes.toFixed(1),
  });
}

function SettingsToggle({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 pr-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {description ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={checked}
        className={`w-10 h-6 rounded-full transition-colors duration-200 relative shrink-0 ${
          checked ? "bg-green-500" : "bg-gray-200 dark:bg-gray-700"
        }`}
      >
        <span
          className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 shadow-sm ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

interface EditorTabProps extends SettingsTabProps {
  isOpen: boolean;
}

export const EditorTab: React.FC<EditorTabProps> = ({
  settings,
  onUpdateSettings,
  isOpen,
}) => {
  const { t } = useI18n();
  const { buildFontOptions } = useFontOptions(isOpen);

  const currentEditorFontValue =
    settings.editorFontFamily?.trim() || DEFAULT_EDITOR_FONT_FAMILY;
  const currentPreviewFontValue =
    settings.previewFontFamily?.trim() || DEFAULT_PREVIEW_FONT_FAMILY;
  const currentCodeFontValue =
    settings.codeFontFamily?.trim() || DEFAULT_CODE_FONT_FAMILY;

  const editorFontOptions = buildFontOptions(currentEditorFontValue);
  const previewFontOptions = buildFontOptions(currentPreviewFontValue);
  const codeFontOptions = buildFontOptions(currentCodeFontValue);
  const newNoteLocation = normalizeNewNoteLocation(settings.newNoteLocation);

  return (
    <div className="space-y-6 animate-fade-in-02s">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_typography")}
        </h3>

        <div className="space-y-5">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_fontSize")}
              </label>
              <span className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-2 py-1 rounded-md">
                {settings.fontSize}px
              </span>
            </div>
            <input
              type="range"
              min="11"
              max="32"
              step="1"
              value={settings.fontSize}
              onChange={(e) =>
                onUpdateSettings({ fontSize: parseInt(e.target.value, 10) })
              }
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings_wordWrap")}
            </label>
            <button
              onClick={() =>
                onUpdateSettings({ ...settings, wordWrap: !settings.wordWrap })
              }
              className={`w-10 h-6 rounded-full transition-colors duration-200 relative ${
                settings.wordWrap
                  ? "bg-green-500"
                  : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <span
                className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 shadow-sm ${
                  settings.wordWrap ? "translate-x-4" : "translate-x-0"
                }`}
              >
                <svg
                  className="w-2.5 h-2.5 text-gray-500 m-[3px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 7h10a3 3 0 1 1 0 6H8" />
                  <polyline points="8 10 5 13 8 16" />
                </svg>
              </span>
            </button>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("settings_markdownStyle")}
            </label>
            <SettingsSelect
              aria-label={t("settings_markdownStyle")}
              value={settings.markdownStylePreset}
              options={[
                { value: "nord", label: t("settings_markdownStyleNord") },
                { value: "topaz", label: t("settings_markdownStyleTopaz") },
                {
                  value: "typewriter",
                  label: t("settings_markdownStyleTypewriter"),
                },
                { value: "primary", label: t("settings_markdownStylePrimary") },
                {
                  value: "minimal",
                  label: t("settings_markdownStyleMinimal"),
                },
                { value: "things", label: t("settings_markdownStyleThings") },
                {
                  value: "catppuccin",
                  label: t("settings_markdownStyleCatppuccin"),
                },
                {
                  value: "solarized",
                  label: t("settings_markdownStyleSolarized"),
                },
              ]}
              onChange={(markdownStylePreset) =>
                onUpdateSettings({
                  markdownStylePreset:
                    markdownStylePreset as AppSettings["markdownStylePreset"],
                })
              }
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings_markdownStyleDesc")}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                {t("settings_editorFont")}
              </label>
              <SettingsSelect
                aria-label={t("settings_editorFont")}
                value={currentEditorFontValue}
                options={editorFontOptions}
                onChange={(editorFontFamily) =>
                  onUpdateSettings({ editorFontFamily })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_editorFontDesc")}
              </p>
              <div
                className="mt-2 rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm text-gray-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-200"
                style={{
                  fontFamily: getResolvedEditorFontFamily(settings),
                  fontSize: `${settings.fontSize}px`,
                }}
              >
                {t("settings_editorFontPreview")}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_previewFont")}
              </label>
              <SettingsSelect
                aria-label={t("settings_previewFont")}
                value={currentPreviewFontValue}
                options={previewFontOptions}
                onChange={(previewFontFamily) =>
                  onUpdateSettings({ previewFontFamily })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_previewFontDesc")}
              </p>
              <div
                className="mt-2 rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm text-gray-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-200"
                style={{
                  fontFamily: getResolvedPreviewFontFamily(settings),
                  fontSize: `${settings.fontSize}px`,
                }}
              >
                {t("settings_previewFontPreview")}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_codeFont")}
              </label>
              <SettingsSelect
                aria-label={t("settings_codeFont")}
                value={currentCodeFontValue}
                options={codeFontOptions}
                onChange={(codeFontFamily) =>
                  onUpdateSettings({ codeFontFamily })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_codeFontDesc")}
              </p>
              <div
                className="mt-2 rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm text-gray-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-200"
                style={{
                  fontFamily: getResolvedCodeFontFamily(settings),
                  fontSize: `${settings.fontSize}px`,
                }}
              >
                {t("settings_codeFontPreview")}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_editorBehavior")}
        </h3>
        <div className="space-y-4">
          <SettingsToggle
            label={t("settings_readableLineLength")}
            description={t("settings_readableLineLengthDesc")}
            checked={settings.readableLineLength}
            onToggle={() =>
              onUpdateSettings({
                readableLineLength: !settings.readableLineLength,
              })
            }
          />
          <SettingsToggle
            label={t("settings_showLineNumbers")}
            checked={settings.showLineNumbers}
            onToggle={() =>
              onUpdateSettings({ showLineNumbers: !settings.showLineNumbers })
            }
          />
          <SettingsToggle
            label={t("settings_enableFolding")}
            description={t("settings_enableFoldingDesc")}
            checked={settings.enableFolding}
            onToggle={() =>
              onUpdateSettings({ enableFolding: !settings.enableFolding })
            }
          />
          <SettingsToggle
            label={t("settings_showIndentationGuides")}
            checked={settings.showIndentationGuides}
            onToggle={() =>
              onUpdateSettings({
                showIndentationGuides: !settings.showIndentationGuides,
              })
            }
          />
          <SettingsToggle
            label={t("settings_spellcheck")}
            checked={settings.spellcheck}
            onToggle={() =>
              onUpdateSettings({ spellcheck: !settings.spellcheck })
            }
          />

          <div className="flex items-start justify-between gap-4 border-t border-gray-200/70 pt-4 dark:border-white/10">
            <div className="min-w-0">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_tabSize")}
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_tabSizeDesc")}
              </p>
            </div>
            <div className="w-[min(16.5rem,52%)] shrink-0">
              <SettingsSelect
                aria-label={t("settings_tabSize")}
                value={String(normalizeTabSize(settings.tabSize))}
                options={[
                  { value: "2", label: "2" },
                  { value: "4", label: "4" },
                ]}
                onChange={(tabSize) =>
                  onUpdateSettings({ tabSize: normalizeTabSize(tabSize) })
                }
              />
            </div>
          </div>

          <SettingsToggle
            label={t("settings_useTabs")}
            description={t("settings_useTabsDesc")}
            checked={settings.useTabs}
            onToggle={() => onUpdateSettings({ useTabs: !settings.useTabs })}
          />
          <SettingsToggle
            label={t("settings_autoPairBrackets")}
            checked={settings.autoPairBrackets}
            onToggle={() =>
              onUpdateSettings({
                autoPairBrackets: !settings.autoPairBrackets,
              })
            }
          />
          <SettingsToggle
            label={t("settings_autoPairMarkdown")}
            checked={settings.autoPairMarkdown}
            onToggle={() =>
              onUpdateSettings({
                autoPairMarkdown: !settings.autoPairMarkdown,
              })
            }
          />
          <SettingsToggle
            label={t("settings_convertHtmlOnPaste")}
            description={t("settings_convertHtmlOnPasteDesc")}
            checked={settings.convertHtmlOnPaste}
            onToggle={() =>
              onUpdateSettings({
                convertHtmlOnPaste: !settings.convertHtmlOnPaste,
              })
            }
          />

          <div className="flex items-start justify-between gap-4 border-t border-gray-200/70 pt-4 dark:border-white/10">
            <div className="min-w-0">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_defaultViewMode")}
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_defaultViewModeDesc")}
              </p>
            </div>
            <div className="w-[min(16.5rem,52%)] shrink-0">
              <SettingsSelect
                aria-label={t("settings_defaultViewMode")}
                value={normalizeDefaultViewMode(settings.defaultViewMode)}
                options={[
                  {
                    value: ViewMode.LIVE,
                    label: t("settings_defaultViewModeLive"),
                  },
                  {
                    value: ViewMode.PREVIEW,
                    label: t("settings_defaultViewModePreview"),
                  },
                ]}
                onChange={(defaultViewMode) =>
                  onUpdateSettings({
                    defaultViewMode: normalizeDefaultViewMode(defaultViewMode),
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_notes")}
        </h3>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 border-b border-gray-200/70 pb-4 dark:border-white/10">
            <div className="min-w-0">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_newNoteLocation")}
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_newNoteLocationDesc")}
              </p>
            </div>
            <div className="w-[min(16.5rem,52%)] shrink-0">
              <SettingsSelect
                aria-label={t("settings_newNoteLocation")}
                value={newNoteLocation}
                options={[
                  {
                    value: "knowledgeBaseRoot",
                    label: t("settings_newNoteLocationRoot"),
                  },
                  {
                    value: "currentFileFolder",
                    label: t("settings_newNoteLocationCurrentFolder"),
                  },
                  {
                    value: "specifiedFolder",
                    label: t("settings_newNoteLocationSpecifiedFolder"),
                  },
                ]}
                onChange={(nextLocation) =>
                  onUpdateSettings({
                    newNoteLocation:
                      nextLocation as AppSettings["newNoteLocation"],
                  })
                }
              />
            </div>
          </div>

          {newNoteLocation === "specifiedFolder" ? (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                {t("settings_newNoteFolder")}
              </label>
              <input
                type="text"
                value={settings.newNoteFolder}
                onChange={(e) =>
                  onUpdateSettings({ newNoteFolder: e.target.value })
                }
                placeholder={t("settings_newNoteFolderPlaceholder")}
                className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all font-mono"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_newNoteFolderDesc")}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_attachments")}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("settings_resourceFolder")}
            </label>
            <input
              type="text"
              value={settings.resourceFolder}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  resourceFolder: e.target.value,
                })
              }
              placeholder={t("settings_resourceFolderPlaceholder")}
              className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all font-mono"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings_resourceFolderDesc")}
            </p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_attachmentLocation")}
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_attachmentLocationDesc")}
              </p>
            </div>
            <div className="w-[min(16.5rem,52%)] shrink-0">
              <SettingsSelect
                aria-label={t("settings_attachmentLocation")}
                value={normalizeAttachmentLocation(settings.attachmentLocation)}
                options={[
                  {
                    value: "resourceFolder",
                    label: t("settings_attachmentLocationResourceFolder"),
                  },
                  {
                    value: "sameAsCurrent",
                    label: t("settings_attachmentLocationSameAsCurrent"),
                  },
                  {
                    value: "subfolderUnderCurrent",
                    label: t("settings_attachmentLocationSubfolder"),
                  },
                ]}
                onChange={(attachmentLocation) =>
                  onUpdateSettings({
                    attachmentLocation:
                      attachmentLocation as AppSettings["attachmentLocation"],
                  })
                }
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("settings_trashFolder")}
            </label>
            <input
              type="text"
              value={settings.trashFolder}
              onChange={(e) =>
                onUpdateSettings({ ...settings, trashFolder: e.target.value })
              }
              placeholder={t("settings_trashFolderPlaceholder")}
              className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all font-mono"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings_trashFolderDesc")}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("settings_attachmentPasteFormat")}
            </label>
            <SettingsSelect
              aria-label={t("settings_attachmentPasteFormat")}
              value={settings.attachmentPasteFormat}
              options={[
                {
                  value: "obsidian",
                  label: t("settings_attachmentFormatObsidian"),
                },
                {
                  value: "markdown",
                  label: t("settings_attachmentFormatMarkdown"),
                },
              ]}
              onChange={(attachmentPasteFormat) =>
                onUpdateSettings({
                  ...settings,
                  attachmentPasteFormat:
                    attachmentPasteFormat as AppSettings["attachmentPasteFormat"],
                })
              }
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings_attachmentPasteFormatDesc")}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_lists")}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("settings_orderedListMode")}
            </label>
            <SettingsSelect
              aria-label={t("settings_orderedListMode")}
              value={settings.orderedListMode}
              options={[
                { value: "strict", label: t("settings_orderedListStrict") },
                { value: "loose", label: t("settings_orderedListLoose") },
              ]}
              onChange={(orderedListMode) =>
                onUpdateSettings({
                  ...settings,
                  orderedListMode:
                    orderedListMode as AppSettings["orderedListMode"],
                })
              }
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings_orderedListModeDesc")}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_saveFormatting")}
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_formatOnManualSave")}
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("settings_formatOnManualSaveDesc")}
              </p>
            </div>
            <button
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  formatMarkdownOnManualSave:
                    !settings.formatMarkdownOnManualSave,
                })
              }
              className={`w-10 h-6 rounded-full transition-colors duration-200 relative shrink-0 ${
                settings.formatMarkdownOnManualSave
                  ? "bg-green-500"
                  : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <span
                className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 shadow-sm ${
                  settings.formatMarkdownOnManualSave
                    ? "translate-x-4"
                    : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_autoSave")}
        </h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_autoSaveInterval")}
              </label>
              <span className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-2 py-1 rounded-md">
                {formatAutoSaveInterval(settings.autoSaveInterval, t)}
              </span>
            </div>
            <input
              type="range"
              min="5000"
              max="1800000"
              step="5000"
              value={settings.autoSaveInterval}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  autoSaveInterval: parseInt(e.target.value),
                })
              }
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
            />
            <div className="flex justify-between mt-1 text-xs text-gray-400">
              <span>{t("settings_seconds", { count: 5 })}</span>
              <span>{t("settings_minutes", { count: 30 })}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("settings_autoSaveDesc")}
          </p>
        </div>
      </div>
    </div>
  );
};

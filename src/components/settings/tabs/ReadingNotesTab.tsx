import React, { useState } from "react";
import { isTauriEnvironment } from "../../../types/filesystem";
import { useI18n } from "../../../hooks/useI18n";
import type { WereadImportFolderMode } from "../../../types";
import type { SettingsTabProps } from "../types";
import { useSecureSettings } from "../useSecureSettings";
import { requestWeReadImportDialog } from "../../../utils/weread/wereadImportEvents";

type ReadingNotesSourceTab = "weread";

export const ReadingNotesTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useI18n();
  const { handleSecureSettingChange, renderSecureSaveState } =
    useSecureSettings(onUpdateSettings);
  const [activeTab, setActiveTab] = useState<ReadingNotesSourceTab>("weread");
  const [showWereadApiKey, setShowWereadApiKey] = useState(false);

  const renderWereadPanel = () => (
    <div className="rounded-2xl border border-gray-200/70 bg-white/70 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03]">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t("settings_wereadSectionTitle")}
      </h4>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
        {t("settings_wereadSectionDesc")}
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_wereadApiKey")}
          </label>
          <div className="relative">
            <input
              type={showWereadApiKey ? "text" : "password"}
              value={settings.wereadApiKey ?? ""}
              onChange={(e) =>
                handleSecureSettingChange("wereadApiKey", e.target.value)
              }
              placeholder={t("settings_wereadApiKeyPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 pr-10 text-sm font-mono transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
            />
            <button
              type="button"
              onClick={() => setShowWereadApiKey((value) => !value)}
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={
                showWereadApiKey
                  ? t("settings_hideToken")
                  : t("settings_showToken")
              }
              aria-label={
                showWereadApiKey
                  ? t("settings_hideToken")
                  : t("settings_showToken")
              }
            >
              {showWereadApiKey ? (
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_wereadApiKeyDesc")}
          </p>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_wereadApiKeyHint")}
          </p>
          {renderSecureSaveState("wereadApiKey")}
        </div>

        <button
          type="button"
          onClick={() => requestWeReadImportDialog()}
          className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:opacity-90 dark:bg-white dark:text-black"
        >
          {t("settings_wereadOpenImport")}
        </button>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_wereadImportFolder")}
          </label>
          <input
            type="text"
            value={settings.wereadImportFolder}
            onChange={(e) =>
              onUpdateSettings({ wereadImportFolder: e.target.value })
            }
            placeholder="读书"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_wereadImportFolderDesc")}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_wereadImportFolderMode")}
          </label>
          <select
            value={settings.wereadImportFolderMode}
            onChange={(e) =>
              onUpdateSettings({
                wereadImportFolderMode: e.target
                  .value as WereadImportFolderMode,
              })
            }
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
          >
            <option value="flat">
              {t("settings_wereadImportFolderModeFlat")}
            </option>
            <option value="author">
              {t("settings_wereadImportFolderModeAuthor")}
            </option>
            <option value="year">
              {t("settings_wereadImportFolderModeYear")}
            </option>
            <option value="authorYear">
              {t("settings_wereadImportFolderModeAuthorYear")}
            </option>
          </select>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.wereadImportSaveCover}
            onChange={(e) =>
              onUpdateSettings({ wereadImportSaveCover: e.target.checked })
            }
          />
          <span>
            {t("settings_wereadSaveCover")}
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              {t("settings_wereadSaveCoverDesc")}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.wereadImportIncludeHotHighlights}
            onChange={(e) =>
              onUpdateSettings({
                wereadImportIncludeHotHighlights: e.target.checked,
              })
            }
          />
          <span>
            {t("settings_wereadIncludeHot")}
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              {t("settings_wereadIncludeHotDesc")}
            </span>
          </span>
        </label>

        <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-xs leading-6 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
          <p>{t("settings_wereadGuide1")}</p>
          <p className="mt-2">{t("settings_wereadGuide2")}</p>
          <p className="mt-2">{t("settings_wereadGuide3")}</p>
        </div>
      </div>
    </div>
  );

  const tabs: Array<{ id: ReadingNotesSourceTab; label: string }> = [
    { id: "weread", label: t("settings_readingNotesTabWeread") },
  ];

  return (
    <div className="space-y-4 animate-fade-in-02s">
      <div>
        <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {t("settings_readingNotesTitle")}
        </h3>

        <div
          className="mb-4 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label={t("settings_readingNotesTitle")}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-gray-900 text-white shadow-sm dark:bg-white dark:text-black"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel">
          {activeTab === "weread" ? renderWereadPanel() : null}
        </div>

        {!isTauriEnvironment() && (
          <p className="mt-4 rounded-xl border border-yellow-200/70 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-200">
            {t("wereadImport_desktopOnly")}
          </p>
        )}
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { isTauriEnvironment } from "../../../types/filesystem";
import {
  isValidOrEmptyBlogRepoUrl,
  isValidOrEmptyBlogSiteUrl,
  normalizeBlogRepoUrl,
  normalizeBlogSiteUrl,
} from "../../../utils/blogRepo";
import { useI18n } from "../../../hooks/useI18n";
import type { SettingsTabProps } from "../types";
import { useSecureSettings } from "../useSecureSettings";
import { requestWeReadImportDialog } from "../../../utils/weread/wereadImportEvents";
import type { WereadImportFolderMode } from "../../../types";

type PublishingTargetTab = "simpleBlog" | "wechat" | "weread";

export const PublishingTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useI18n();
  const { handleSecureSettingChange, renderSecureSaveState } =
    useSecureSettings(onUpdateSettings);
  const [activeTab, setActiveTab] = useState<PublishingTargetTab>("simpleBlog");
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showWechatSecret, setShowWechatSecret] = useState(false);
  const [showWereadApiKey, setShowWereadApiKey] = useState(false);

  const renderSimpleBlogPanel = () => (
    <div className="rounded-2xl border border-gray-200/70 bg-white/70 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03]">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t("settings_simpleBlogSectionTitle")}
      </h4>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
        {t("settings_simpleBlogSectionDesc")}
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_blogRepoUrl")}
          </label>
          <input
            type="text"
            value={settings.blogRepoUrl}
            onChange={(e) => onUpdateSettings({ blogRepoUrl: e.target.value })}
            onBlur={() => {
              const normalized = normalizeBlogRepoUrl(settings.blogRepoUrl);
              if (normalized && normalized !== settings.blogRepoUrl) {
                onUpdateSettings({ blogRepoUrl: normalized });
              }
            }}
            placeholder={t("settings_blogRepoUrlPlaceholder")}
            className={`w-full rounded-xl border px-3 py-2 text-sm transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 bg-white dark:bg-white/5 ${
              isValidOrEmptyBlogRepoUrl(settings.blogRepoUrl)
                ? "border-gray-200 dark:border-white/10"
                : "border-red-500 dark:border-red-500"
            }`}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_blogRepoUrlDesc")}
          </p>
          {settings.blogRepoUrl &&
            !isValidOrEmptyBlogRepoUrl(settings.blogRepoUrl) && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {t("settings_blogRepoUrlInvalid")}
              </p>
            )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_githubToken")}
          </label>
          <div className="relative">
            <input
              type={showGithubToken ? "text" : "password"}
              value={settings.blogGithubToken ?? ""}
              onChange={(e) =>
                handleSecureSettingChange("blogGithubToken", e.target.value)
              }
              placeholder="github_pat_xxx..."
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 pr-10 text-sm font-mono transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
            />
            <button
              type="button"
              onClick={() => setShowGithubToken((value) => !value)}
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={
                showGithubToken
                  ? t("settings_hideToken")
                  : t("settings_showToken")
              }
              aria-label={
                showGithubToken
                  ? t("settings_hideToken")
                  : t("settings_showToken")
              }
            >
              {showGithubToken ? (
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
            {t("settings_githubTokenDesc")}
          </p>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_githubTokenPermission")}
          </p>
          {renderSecureSaveState("blogGithubToken")}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_blogSiteUrl")}
          </label>
          <input
            type="text"
            value={settings.blogSiteUrl}
            onChange={(e) => onUpdateSettings({ blogSiteUrl: e.target.value })}
            onBlur={() => {
              const normalized = normalizeBlogSiteUrl(settings.blogSiteUrl);
              if (normalized && normalized !== settings.blogSiteUrl) {
                onUpdateSettings({ blogSiteUrl: normalized });
              }
            }}
            placeholder={t("settings_blogSiteUrlPlaceholder")}
            className={`w-full rounded-xl border px-3 py-2 text-sm transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 bg-white dark:bg-white/5 ${
              isValidOrEmptyBlogSiteUrl(settings.blogSiteUrl)
                ? "border-gray-200 dark:border-white/10"
                : "border-red-500 dark:border-red-500"
            }`}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_blogSiteUrlDesc")}
          </p>
          {settings.blogSiteUrl &&
            !isValidOrEmptyBlogSiteUrl(settings.blogSiteUrl) && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {t("settings_blogSiteUrlInvalid")}
              </p>
            )}
        </div>
      </div>
    </div>
  );

  const renderWechatPanel = () => (
    <div className="rounded-2xl border border-gray-200/70 bg-white/70 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03]">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t("settings_wechatSectionTitle")}
      </h4>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
        {t("settings_wechatSectionDesc")}
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_wechatAppId")}
          </label>
          <input
            type="text"
            value={settings.wechatAppId}
            onChange={(e) => onUpdateSettings({ wechatAppId: e.target.value })}
            placeholder={t("settings_wechatAppIdPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_wechatAppIdDesc")}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_wechatAppSecret")}
          </label>
          <div className="relative">
            <input
              type={showWechatSecret ? "text" : "password"}
              value={settings.wechatAppSecret ?? ""}
              onChange={(e) =>
                handleSecureSettingChange("wechatAppSecret", e.target.value)
              }
              placeholder={t("settings_wechatAppSecretPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 pr-10 text-sm font-mono transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
            />
            <button
              type="button"
              onClick={() => setShowWechatSecret((value) => !value)}
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={
                showWechatSecret
                  ? t("settings_hideToken")
                  : t("settings_showToken")
              }
              aria-label={
                showWechatSecret
                  ? t("settings_hideToken")
                  : t("settings_showToken")
              }
            >
              {showWechatSecret ? (
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
            {t("settings_wechatAppSecretDesc")}
          </p>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_wechatAppSecretHint")}
          </p>
          {renderSecureSaveState("wechatAppSecret")}
        </div>

        <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-xs leading-6 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
          <p>{t("settings_wechatGuide1")}</p>
          <p className="mt-2">{t("settings_wechatGuide2")}</p>
          <p className="mt-2">{t("settings_wechatGuide3")}</p>
        </div>
      </div>
    </div>
  );

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

        <button
          type="button"
          onClick={() => requestWeReadImportDialog()}
          className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:opacity-90 dark:bg-white dark:text-black"
        >
          {t("settings_wereadOpenImport")}
        </button>

        <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-xs leading-6 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
          <p>{t("settings_wereadGuide1")}</p>
          <p className="mt-2">{t("settings_wereadGuide2")}</p>
          <p className="mt-2">{t("settings_wereadGuide3")}</p>
        </div>
      </div>
    </div>
  );

  const tabs: Array<{ id: PublishingTargetTab; label: string }> = [
    { id: "simpleBlog", label: t("settings_publishingTabSimpleBlog") },
    { id: "wechat", label: t("settings_publishingTabWechat") },
    { id: "weread", label: t("settings_publishingTabWeread") },
  ];

  return (
    <div className="space-y-4 animate-fade-in-02s">
      <div>
        <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {t("settings_publishingTitle")}
        </h3>

        <div
          className="mb-4 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label={t("settings_publishingTitle")}
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
          {activeTab === "simpleBlog"
            ? renderSimpleBlogPanel()
            : activeTab === "wechat"
              ? renderWechatPanel()
              : renderWereadPanel()}
        </div>

        {!isTauriEnvironment() && (
          <p className="mt-4 rounded-xl border border-yellow-200/70 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-200">
            {t("settings_desktopPublishOnly")}
          </p>
        )}
      </div>
    </div>
  );
};

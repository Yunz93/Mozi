import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../hooks/useI18n";
import { useAppStore } from "../../../store/appStore";
import type { AppSettings } from "../../../types";
import { isTauriEnvironment } from "../../../types/filesystem";
import { isLinuxPlatform, isMacOSPlatform } from "../../../utils/platform";
import { openExternalUrl } from "../../../utils/externalLinks";
import type { SettingsTabProps } from "../types";
import {
  checkForAppUpdate,
  downloadAndInstallUpdate,
  getInstalledAppVersion,
  RELEASES_PAGE_URL,
  areUpdaterArtifactsEnabled,
  isInAppUpdaterSupported,
  type AvailableUpdate,
  type UpdateDownloadEvent,
} from "../../../services/updaterService";
import { UsageStatisticsPreference } from "../UsageStatisticsPreference";
import { UpdateProgressPanel } from "../UpdateProgressPanel";
import {
  INITIAL_UPDATE_DOWNLOAD_PROGRESS,
  applyUpdateDownloadEvent,
  startUpdateDownload,
} from "../../../utils/updateProgress";

type StatusTone = "neutral" | "success" | "error";

function formatTimestamp(
  value: string,
  locale: AppSettings["language"],
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
}

function formatUpdateBody(body?: string): string {
  return body?.trim() || "";
}

export const UpdatesTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t, language } = useI18n();
  const showNotification = useAppStore((state) => state.showNotification);
  const isDesktop = isTauriEnvironment();
  const isLinux = useMemo(() => isLinuxPlatform(), []);
  const isMac = useMemo(() => isMacOSPlatform(), []);
  const canUpdateInApp = isInAppUpdaterSupported();
  const acceptBetaUpdates = settings.acceptBetaUpdates === true;
  const updateChannelRef = useRef(acceptBetaUpdates);
  updateChannelRef.current = acceptBetaUpdates;
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [availableUpdate, setAvailableUpdate] =
    useState<AvailableUpdate | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState(
    INITIAL_UPDATE_DOWNLOAD_PROGRESS,
  );

  useEffect(() => {
    let active = true;

    if (!isDesktop) {
      return;
    }

    void getInstalledAppVersion()
      .then((version) => {
        if (!active || !version) return;
        setCurrentVersion(version);
      })
      .catch((error) => {
        console.warn("Failed to load installed app version:", error);
      });

    return () => {
      active = false;
    };
  }, [isDesktop]);

  useEffect(() => {
    return () => {
      void availableUpdate?.close().catch(() => {});
    };
  }, [availableUpdate]);

  useEffect(() => {
    setAvailableUpdate(null);
    setStatusMessage("");
    setDownloadProgress(INITIAL_UPDATE_DOWNLOAD_PROGRESS);
  }, [acceptBetaUpdates]);

  const lastCheckedAt = formatTimestamp(settings.lastUpdateCheckAt, language);
  const updateBody = formatUpdateBody(availableUpdate?.body);
  const updatePublishedAt = formatTimestamp(
    availableUpdate?.date ?? "",
    language,
  );

  const replaceAvailableUpdate = async (nextUpdate: AvailableUpdate | null) => {
    const previous = availableUpdate;
    setAvailableUpdate(nextUpdate);
    if (previous && previous !== nextUpdate) {
      await previous.close().catch(() => {});
    }
  };

  const handleCheckUpdates = async (): Promise<AvailableUpdate | null> => {
    if (!canUpdateInApp) {
      return null;
    }

    setIsChecking(true);
    setStatusTone("neutral");
    setStatusMessage(t("settings_updatesChecking"));
    setDownloadProgress(INITIAL_UPDATE_DOWNLOAD_PROGRESS);

    try {
      if (!isMac && !areUpdaterArtifactsEnabled()) {
        await replaceAvailableUpdate(null);
        setStatusTone("neutral");
        setStatusMessage(t("settings_updatesArtifactsDisabled"));
        showNotification(t("settings_updatesArtifactsDisabled"), "info");
        return null;
      }

      const update = await checkForAppUpdate(acceptBetaUpdates);
      // 切换渠道后丢弃旧请求结果，避免显示或安装上一个渠道的更新。
      if (updateChannelRef.current !== acceptBetaUpdates) {
        await update?.close().catch(() => {});
        return null;
      }
      onUpdateSettings({ lastUpdateCheckAt: new Date().toISOString() });
      await replaceAvailableUpdate(update);

      if (!update) {
        setStatusTone("success");
        setStatusMessage(t("settings_updatesUpToDate"));
        showNotification(t("notifications_updateNotAvailable"), "success");
        return null;
      }

      setStatusTone("success");
      setStatusMessage(
        t("settings_updatesAvailableStatus", { version: update.version }),
      );
      showNotification(
        t("notifications_updateAvailable", { version: update.version }),
        "info",
      );
      return update;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatusTone("error");
      setStatusMessage(t("settings_updatesCheckFailed", { error: detail }));
      showNotification(
        t("notifications_updateCheckFailed", { error: detail }),
        "error",
      );
      return null;
    } finally {
      setIsChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    let update = availableUpdate;
    if (!update) {
      update = await handleCheckUpdates();
    }

    if (!update) {
      return;
    }

    setIsInstalling(true);
    setStatusTone("neutral");
    setStatusMessage(
      t("settings_updatesPreparingInstall", { version: update.version }),
    );
    setDownloadProgress(startUpdateDownload());

    try {
      await downloadAndInstallUpdate(update, (event: UpdateDownloadEvent) => {
        setDownloadProgress((previous) =>
          applyUpdateDownloadEvent(previous, event),
        );
        switch (event.event) {
          case "Started":
            setStatusMessage(t("settings_updatesDownloading"));
            break;
          case "Finished":
            setStatusMessage(t("settings_updatesInstalling"));
            break;
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatusTone("error");
      setStatusMessage(t("settings_updatesInstallFailed", { error: detail }));
      showNotification(
        t("notifications_updateInstallFailed", { error: detail }),
        "error",
      );
    } finally {
      setIsInstalling(false);
      setDownloadProgress(INITIAL_UPDATE_DOWNLOAD_PROGRESS);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-02s">
      <h4 className="text-base font-semibold text-gray-900 dark:text-white">
        {t("settings_aboutTitle")}
      </h4>

      <div className="rounded-3xl border border-gray-200/70 bg-gray-50/80 px-6 py-6 text-sm text-gray-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-200">
        <p className="text-base font-semibold text-gray-900 dark:text-white">
          {t("settings_aboutAuthor")}
        </p>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {t("settings_aboutAuthorValue")}
        </p>
        <p className="mt-10 text-base font-semibold text-gray-900 dark:text-white">
          {t("settings_aboutMessage")}
        </p>
        <p className="mt-4 text-sm leading-9 text-gray-600 dark:text-gray-300">
          {t("settings_aboutMessageValue")}
        </p>
      </div>

      <UsageStatisticsPreference />

      <div>
        <h5 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("settings_updatesSectionTitle")}
        </h5>

        {!isDesktop && (
          <p className="mt-4 rounded-2xl border border-yellow-200/70 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-200">
            {t("settings_updatesDesktopOnly")}
          </p>
        )}

        {isDesktop && canUpdateInApp && (
          <div className="mt-4 space-y-4">
            <div className="rounded-3xl border border-gray-200/70 bg-gray-50/80 px-6 py-6 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">
                    {t("settings_updatesCurrentVersionLabel")}
                  </p>
                  <p className="mt-2 font-mono text-sm text-gray-900 dark:text-white">
                    {currentVersion || t("common_loading")}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">
                    {t("settings_updatesLastCheckLabel")}
                  </p>
                  <p className="mt-2 text-sm text-gray-900 dark:text-white">
                    {lastCheckedAt || t("settings_updatesNeverChecked")}
                  </p>
                </div>
              </div>

              <label className="mt-6 flex items-start gap-3 rounded-2xl border border-gray-200/70 bg-white/80 px-4 py-4 dark:border-white/10 dark:bg-black/10">
                <input
                  type="checkbox"
                  checked={settings.autoCheckForUpdates}
                  onChange={(event) =>
                    onUpdateSettings({
                      autoCheckForUpdates: event.target.checked,
                    })
                  }
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-black focus:ring-black dark:border-white/20 dark:bg-white/5 dark:text-white dark:focus:ring-white"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {t("settings_updatesAutoCheck")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {t("settings_updatesAutoCheckDesc")}
                  </p>
                </div>
              </label>

              <label className="mt-3 flex items-start gap-3 rounded-2xl border border-gray-200/70 bg-white/80 px-4 py-4 dark:border-white/10 dark:bg-black/10">
                <input
                  type="checkbox"
                  checked={acceptBetaUpdates}
                  disabled={isChecking || isInstalling}
                  onChange={(event) =>
                    onUpdateSettings({
                      acceptBetaUpdates: event.target.checked,
                    })
                  }
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-black focus:ring-black disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-white/5 dark:text-white dark:focus:ring-white"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {t("settings_updatesAcceptBeta")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {t("settings_updatesAcceptBetaDesc")}
                  </p>
                </div>
              </label>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void handleCheckUpdates();
                  }}
                  disabled={isChecking || isInstalling}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
                >
                  {isChecking
                    ? t("settings_updatesChecking")
                    : t("settings_updatesCheckNow")}
                </button>

                {availableUpdate && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleInstallUpdate();
                    }}
                    disabled={isInstalling || isChecking}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {downloadProgress.phase === "downloading"
                      ? t("settings_updatesDownloading")
                      : downloadProgress.phase === "preparing"
                        ? t("settings_updatesPreparingInstall", {
                            version: availableUpdate.version,
                          })
                        : isInstalling
                          ? t("settings_updatesInstalling")
                          : t("settings_updatesInstallNow")}
                  </button>
                )}

                {availableUpdate &&
                  settings.skippedUpdateVersion !== availableUpdate.version && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          skippedUpdateVersion: availableUpdate.version,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
                    >
                      {t("settings_updatesSkipVersion")}
                    </button>
                  )}

                {settings.skippedUpdateVersion && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ skippedUpdateVersion: "" })
                    }
                    className="inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
                  >
                    {t("settings_updatesResumeSkipped")}
                  </button>
                )}
              </div>

              {statusMessage && downloadProgress.phase === "idle" && (
                <p
                  className={`mt-4 text-xs ${
                    statusTone === "error"
                      ? "text-red-500"
                      : statusTone === "success"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {statusMessage}
                </p>
              )}

              <UpdateProgressPanel
                progress={downloadProgress}
                version={availableUpdate?.version}
              />
            </div>

            {availableUpdate && (
              <div className="rounded-3xl border border-gray-200/70 bg-gray-50/80 px-6 py-6 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t("settings_updatesAvailableVersion", {
                        version: availableUpdate.version,
                      })}
                    </p>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {t("settings_updatesCurrentVersion")}
                      <span className="ml-1 font-mono">
                        {availableUpdate.currentVersion}
                      </span>
                      {updatePublishedAt ? (
                        <span className="ml-3">
                          {t("settings_updatesPublishedAt", {
                            date: updatePublishedAt,
                          })}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {settings.skippedUpdateVersion ===
                    availableUpdate.version && (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      {t("settings_updatesSkippedBadge")}
                    </span>
                  )}
                </div>

                {updateBody && (
                  <div className="mt-5">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">
                      {t("settings_updatesReleaseNotes")}
                    </p>
                    <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-white px-4 py-4 text-xs leading-6 text-gray-700 dark:bg-black/20 dark:text-gray-200">
                      {updateBody}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-3xl border border-gray-200/70 bg-gray-50/80 px-6 py-5 text-sm leading-7 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
              <p>
                {isMac
                  ? t("settings_updatesMacGuide1")
                  : isLinux
                    ? t("settings_updatesLinuxGuide1")
                    : t("settings_updatesGuide1")}
              </p>
              <p className="mt-2">
                {isMac
                  ? t("settings_updatesMacGuide2")
                  : isLinux
                    ? t("settings_updatesLinuxGuide2")
                    : t("settings_updatesGuide2")}
              </p>
              <p className="mt-4">
                <a
                  href={RELEASES_PAGE_URL}
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternalUrl(RELEASES_PAGE_URL);
                  }}
                  className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-900 dark:text-white dark:decoration-white/20 dark:hover:decoration-white"
                >
                  {t("settings_updatesOpenReleases")}
                </a>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

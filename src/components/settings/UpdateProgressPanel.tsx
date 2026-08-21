import React from "react";
import { useI18n } from "../../hooks/useI18n";
import {
  formatByteSize,
  getUpdateProgressBarPercent,
  type UpdateDownloadProgress,
  type UpdateInstallPhase,
} from "../../utils/updateProgress";

type ActiveUpdatePhase = Exclude<UpdateInstallPhase, "idle">;

interface UpdateProgressPanelProps {
  progress: UpdateDownloadProgress;
  version?: string;
}

function getPhaseStatusKey(phase: ActiveUpdatePhase) {
  switch (phase) {
    case "preparing":
      return "settings_updatesPreparingInstall" as const;
    case "installing":
      return "settings_updatesInstalling" as const;
    default:
      return "settings_updatesDownloading" as const;
  }
}

export const UpdateProgressPanel: React.FC<UpdateProgressPanelProps> = ({
  progress,
  version,
}) => {
  const { t } = useI18n();

  if (progress.phase === "idle") {
    return null;
  }

  const percent = getUpdateProgressBarPercent(progress);
  const status = t(getPhaseStatusKey(progress.phase), {
    version: version ?? "",
  });
  const bytesLabel =
    progress.downloadSize && progress.downloadSize > 0
      ? t("settings_updatesProgressBytes", {
          downloaded: formatByteSize(progress.downloadedBytes),
          total: formatByteSize(progress.downloadSize),
        })
      : progress.downloadedBytes > 0
        ? t("settings_updatesProgressDownloaded", {
            downloaded: formatByteSize(progress.downloadedBytes),
          })
        : null;

  return (
    <div
      className="mt-5 space-y-2 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 px-4 py-3.5 dark:border-emerald-500/20 dark:bg-emerald-500/10"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t("settings_updatesProgressLabel")}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-100">
        <p className="font-medium">{status}</p>
        {percent !== null ? (
          <p className="shrink-0 tabular-nums">
            {t("settings_updatesProgressPercent", { percent })}
          </p>
        ) : null}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-emerald-200/80 dark:bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={
          percent !== null
            ? t("settings_updatesProgressPercent", { percent })
            : status
        }
      >
        {percent !== null ? (
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 rounded-full bg-emerald-500 animate-progress-indeterminate" />
        )}
      </div>
      {bytesLabel ? (
        <p className="text-[11px] tabular-nums text-emerald-800/80 dark:text-emerald-200/80">
          {bytesLabel}
        </p>
      ) : null}
    </div>
  );
};

import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../../hooks/useI18n";
import { isTauriEnvironment } from "../../types/filesystem";
import {
  getUsageStatisticsStatus,
  setUsageStatisticsEnabled,
  USAGE_STATISTICS_CHANGED,
  type UsageStatisticsStatus,
} from "../../services/usageStatisticsService";

export function UsageStatisticsPreference() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UsageStatisticsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void getUsageStatisticsStatus()
        .then((value) => {
          if (!disposed) setStatus(value);
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    };
    refresh();
    const subscription = isTauriEnvironment()
      ? listen(USAGE_STATISTICS_CHANGED, refresh).catch(() => null)
      : null;
    return () => {
      disposed = true;
      if (subscription) void subscription.then((unlisten) => unlisten?.());
    };
  }, []);
  const change = async (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      setStatus(await setUsageStatisticsEnabled(enabled));
    } catch {
      setFailed(true);
      void getUsageStatisticsStatus()
        .then(setStatus)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="mt-6 border-t pt-4 text-left"
      style={{ borderColor: "var(--workspace-divider)" }}
    >
      <label
        className="flex items-start gap-2 text-sm"
        style={{ color: "var(--workspace-text)" }}
      >
        <input
          type="checkbox"
          className="mt-1"
          style={{ accentColor: "var(--workspace-accent)" }}
          checked={status?.enabled ?? false}
          disabled={!status || (!status.available && !status.enabled) || busy}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>{t("statistics_participate")}</span>
      </label>
      <p
        className="mt-2 text-xs leading-5"
        style={{ color: "var(--workspace-muted)" }}
      >
        {t("statistics_description")}
      </p>
      {status && !status.available && (
        <p className="mt-1 text-xs" style={{ color: "var(--workspace-muted)" }}>
          {t("statistics_unavailable")}
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">
          {t("statistics_saveFailed")}
        </p>
      )}
    </section>
  );
}

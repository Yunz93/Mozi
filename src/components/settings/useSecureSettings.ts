import React, { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../../types";
import {
  persistSecureSetting,
  type SensitiveSettingKey,
} from "../../services/secureSettingsService";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../hooks/useI18n";

type SecureSaveState = {
  type: "saving" | "saved" | "error";
  message: string;
};

export function useSecureSettings(
  onUpdateSettings: (updates: Partial<AppSettings>) => void,
) {
  const { t, language } = useI18n();
  const showNotification = useAppStore((state) => state.showNotification);
  const [secureSaveStates, setSecureSaveStates] = useState<
    Partial<Record<SensitiveSettingKey, SecureSaveState>>
  >({});
  const secureSaveRequestIdRef = useRef<Record<SensitiveSettingKey, number>>({
    blogGithubToken: 0,
    wechatAppSecret: 0,
    wereadApiKey: 0,
    geminiApiKey: 0,
    codexApiKey: 0,
    deepseekApiKey: 0,
    embeddingApiKey: 0,
    imageHostingGithubToken: 0,
    imageHostingS3SecretAccessKey: 0,
    imageHostingOssAccessKeySecret: 0,
    imageHostingQiniuSecretKey: 0,
  });
  const secureSaveResetTimerRef = useRef<
    Partial<Record<SensitiveSettingKey, number>>
  >({});

  useEffect(() => {
    return () => {
      Object.values(secureSaveResetTimerRef.current).forEach((timerId) => {
        if (typeof timerId === "number") {
          window.clearTimeout(timerId);
        }
      });
    };
  }, []);

  const setSecureSaveState = (
    key: SensitiveSettingKey,
    state: SecureSaveState | null,
  ) => {
    setSecureSaveStates((prev) => {
      if (!state) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: state };
    });
  };

  const scheduleSecureSaveStateClear = (
    key: SensitiveSettingKey,
    requestId: number,
  ) => {
    const previousTimer = secureSaveResetTimerRef.current[key];
    if (typeof previousTimer === "number") {
      window.clearTimeout(previousTimer);
    }

    secureSaveResetTimerRef.current[key] = window.setTimeout(() => {
      if (secureSaveRequestIdRef.current[key] !== requestId) {
        return;
      }
      delete secureSaveResetTimerRef.current[key];
      setSecureSaveState(key, null);
    }, 2200);
  };

  const handleSecureSettingChange = (
    key: SensitiveSettingKey,
    value: string,
  ) => {
    secureSaveRequestIdRef.current[key] += 1;
    const requestId = secureSaveRequestIdRef.current[key];
    const previousTimer = secureSaveResetTimerRef.current[key];
    if (typeof previousTimer === "number") {
      window.clearTimeout(previousTimer);
      delete secureSaveResetTimerRef.current[key];
    }

    onUpdateSettings({ [key]: value } as Partial<AppSettings>);
    setSecureSaveState(key, {
      type: "saving",
      message: t("settings_secureSaving"),
    });

    void persistSecureSetting(key, value)
      .then(() => {
        if (secureSaveRequestIdRef.current[key] !== requestId) return;
        setSecureSaveState(key, {
          type: "saved",
          message: t("settings_secureSaved"),
        });
        scheduleSecureSaveStateClear(key, requestId);
      })
      .catch((error) => {
        if (secureSaveRequestIdRef.current[key] !== requestId) return;
        console.error(`Failed to persist secure setting ${key}:`, error);
        const detail = error instanceof Error ? error.message : String(error);
        setSecureSaveState(key, {
          type: "error",
          message:
            language === "zh-CN"
              ? `安全保存失败：${detail}`
              : `Secure save failed: ${detail}`,
        });
        showNotification(
          language === "zh-CN"
            ? `安全保存密钥失败：${detail}`
            : `Failed to securely save the secret: ${detail}`,
          "error",
        );
      });
  };

  const renderSecureSaveState = (key: SensitiveSettingKey): React.ReactNode => {
    const state = secureSaveStates[key];
    if (!state) return null;

    const colorClass =
      state.type === "error"
        ? "text-red-500"
        : state.type === "saved"
          ? "text-green-600 dark:text-green-400"
          : "text-gray-500 dark:text-gray-400";

    return React.createElement(
      "p",
      { className: `text-[10px] ${colorClass}` },
      state.message,
    );
  };

  return { handleSecureSettingChange, renderSecureSaveState };
}

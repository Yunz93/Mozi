import React from "react";
import type { AppSettings } from "../../../types";
import {
  DEFAULT_UI_FONT_FAMILY,
  getResolvedUiFontFamily,
} from "../../../utils/fontSettings";
import {
  clampUiFontSize,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
} from "../../../utils/uiFontSize";
import { useI18n } from "../../../hooks/useI18n";
import type { SettingsTabProps } from "../types";
import { useFontOptions } from "../useFontOptions";
import { SettingsSelect } from "../SettingsSelect";
import { normalizeUiAccentColor } from "../../../utils/uiAccentColor";

interface InterfaceTabProps extends SettingsTabProps {
  isOpen: boolean;
}

export const InterfaceTab: React.FC<InterfaceTabProps> = ({
  settings,
  onUpdateSettings,
  isOpen,
}) => {
  const { t, language } = useI18n();
  const { buildFontOptions, isLoadingSystemFonts } = useFontOptions(isOpen);

  const currentUiFontValue =
    settings.uiFontFamily?.trim() || DEFAULT_UI_FONT_FAMILY;
  const uiFontOptions = buildFontOptions(currentUiFontValue);
  const selectedAccentColor = normalizeUiAccentColor(settings.uiAccentColor);
  const accentOptions = [
    {
      value: "default",
      color: "#a65f43",
      label: t("settings_uiAccentDefault"),
    },
    { value: "#3b82f6", color: "#3b82f6", label: t("settings_uiAccentBlue") },
    { value: "#22a06b", color: "#22a06b", label: t("settings_uiAccentGreen") },
    { value: "#8b5cf6", color: "#8b5cf6", label: t("settings_uiAccentPurple") },
    { value: "#db6480", color: "#db6480", label: t("settings_uiAccentRose") },
  ];

  const themeOptions: Array<{
    value: "light" | "dark" | "system";
    label: string;
  }> = [
    { value: "light", label: t("settings_themeLight") },
    { value: "dark", label: t("settings_themeDark") },
    { value: "system", label: t("settings_themeSystem") },
  ];

  return (
    <div className="space-y-6 animate-fade-in-02s">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("settings_interface")}
        </h3>
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings_languageLabel")}
            </label>
            <SettingsSelect
              aria-label={t("settings_languageLabel")}
              value={language}
              options={[
                { value: "zh-CN", label: t("common_simplifiedChinese") },
                { value: "en", label: t("common_english") },
              ]}
              onChange={(nextLanguage) => {
                onUpdateSettings({
                  language: nextLanguage as AppSettings["language"],
                });
              }}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings_interfaceDesc")}
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings_themeLabel")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map((option) => {
                const isSelected =
                  option.value === "system"
                    ? settings.themeFollowSystem
                    : !settings.themeFollowSystem &&
                      settings.themeMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (option.value === "system") {
                        onUpdateSettings({ themeFollowSystem: true });
                      } else {
                        onUpdateSettings({
                          themeFollowSystem: false,
                          themeMode: option.value,
                        });
                      }
                    }}
                    className={`workspace-settings-theme-choice border px-3 py-2 text-sm ${isSelected ? "is-active" : ""}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings_themeDesc")}
            </p>
          </div>

          <div className="space-y-2">
            <div className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings_uiAccentColor")}
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("settings_uiAccentColor")}
            >
              {accentOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  aria-pressed={selectedAccentColor === option.value}
                  className={`workspace-settings-accent-choice ${selectedAccentColor === option.value ? "is-active" : ""}`}
                  onClick={() =>
                    onUpdateSettings({ uiAccentColor: option.value })
                  }
                >
                  <span
                    className="workspace-settings-accent-swatch"
                    style={{ backgroundColor: option.color }}
                    aria-hidden
                  />
                  {option.label}
                </button>
              ))}
              <label
                htmlFor="ui-accent-color"
                className={`workspace-settings-accent-choice ${accentOptions.some((option) => option.value === selectedAccentColor) ? "" : "is-active"}`}
              >
                <input
                  id="ui-accent-color"
                  type="color"
                  aria-label={t("settings_uiAccentCustom")}
                  title={t("settings_uiAccentCustom")}
                  className="workspace-settings-color-input"
                  value={
                    selectedAccentColor === "default"
                      ? settings.themeMode === "dark"
                        ? "#d49b7e"
                        : "#a65f43"
                      : selectedAccentColor
                  }
                  onChange={(event) =>
                    onUpdateSettings({ uiAccentColor: event.target.value })
                  }
                />
                {t("settings_uiAccentCustomShort")}
              </label>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings_uiAccentColorDesc")}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_uiFont")}
              </label>
              {isLoadingSystemFonts && (
                <span className="text-[11px] text-gray-400">
                  {t("common_loading")}
                </span>
              )}
            </div>
            <SettingsSelect
              aria-label={t("settings_uiFont")}
              value={currentUiFontValue}
              options={uiFontOptions}
              onChange={(uiFontFamily) => onUpdateSettings({ uiFontFamily })}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings_uiFontDesc")}
            </p>
            <div
              className="workspace-settings-font-preview border px-4 py-3 text-sm"
              style={{ fontFamily: getResolvedUiFontFamily(settings) }}
            >
              {t("settings_uiFontPreview")}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("settings_uiFontSize")}
              </label>
              <span className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-2 py-1 rounded-md">
                {settings.uiFontSize}px
              </span>
            </div>
            <input
              type="range"
              min={UI_FONT_SIZE_MIN}
              max={UI_FONT_SIZE_MAX}
              step="1"
              value={settings.uiFontSize}
              onChange={(e) =>
                onUpdateSettings({
                  uiFontSize: clampUiFontSize(parseInt(e.target.value, 10)),
                })
              }
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t("settings_uiFontSizeDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

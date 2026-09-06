import React from "react";
import { Icons } from "../Icon";
import { useI18n } from "../../hooks/useI18n";

export interface KnowledgeBaseHeaderProps {
  name?: string;
  path?: string;
  disabled?: boolean;
  onSwitch: () => void;
  onOpenSettings: () => void;
}

export const KnowledgeBaseHeader: React.FC<KnowledgeBaseHeaderProps> = ({
  name,
  path,
  disabled = false,
  onSwitch,
  onOpenSettings,
}) => {
  const { t } = useI18n();
  const label = name || t("app_openKnowledgeBase");

  return (
    <div
      className={`flex items-center gap-1 w-full px-2 py-1.5 rounded-xl border border-gray-200/70 dark:border-white/10 ${
        disabled
          ? "bg-gray-100/70 dark:bg-[#0f141c]"
          : "bg-white/60 dark:bg-[#121923]"
      }`}
    >
      <button
        type="button"
        onClick={onSwitch}
        disabled={disabled}
        aria-disabled={disabled}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${
          disabled
            ? "cursor-not-allowed text-gray-400 dark:text-gray-600"
            : "text-gray-700 hover:bg-white/90 dark:text-gray-200 dark:hover:bg-[#18212e]"
        }`}
        title={
          disabled
            ? t("sidebar_openKnowledgeBaseDisabledStandalone")
            : path || t("app_openKnowledgeBase")
        }
      >
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <p className="text-sm font-semibold truncate min-w-0">{label}</p>
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/90 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-[#18212e] dark:hover:text-gray-300"
        title={t("settings_openSettings")}
        aria-label={t("settings_openSettings")}
      >
        <Icons.Settings size={16} />
      </button>
    </div>
  );
};

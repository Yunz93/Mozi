import React from "react";
import { useI18n } from "../../hooks/useI18n";

interface AIButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export const AIButton: React.FC<AIButtonProps> = ({
  onClick,
  disabled = false,
  isLoading = false,
}) => {
  const { t } = useI18n();

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      title={isLoading ? t("ai_buttonLoading") : t("ai_button")}
      aria-label={isLoading ? t("ai_buttonLoading") : t("ai_button")}
      className={`
        inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95
        ${
          isLoading
            ? "bg-white/70 dark:bg-white/5 text-gray-400 cursor-wait"
            : "bg-white/80 dark:bg-white/[0.06] text-amber-600 dark:text-amber-300 hover:bg-white dark:hover:bg-white/10"
        }
      `}
    >
      <svg
        className={`h-3.5 w-3.5 ${isLoading ? "animate-pulse" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M8 14a6 6 0 1 1 8 0c-.8.7-1.4 1.7-1.6 2.8a1 1 0 0 1-1 .8h-2.8a1 1 0 0 1-1-.8C9.4 15.7 8.8 14.7 8 14Z" />
      </svg>
    </button>
  );
};

/**
 * Toolbar toggle: Live Preview / Reading.
 *
 * Icons use distinct silhouettes at toolbar size:
 * - Live: pen on document (editable rendered surface)
 * - Reading: open book with page lines
 */

import React from "react";
import { ViewMode } from "../../types";
import { useI18n } from "../../hooks/useI18n";
import { normalizeSessionViewMode } from "../../utils/viewMode";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  previewOnly?: boolean;
}

function ModeIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  viewMode,
  onViewModeChange,
  previewOnly = false,
}) => {
  const { t } = useI18n();
  const mode = normalizeSessionViewMode(viewMode);

  const inactiveClass =
    "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-white/60 dark:hover:bg-white/5";
  const disabledClass = "text-gray-200 dark:text-gray-700 cursor-not-allowed";
  const activeClass =
    "bg-white dark:bg-gray-800 shadow-sm text-black dark:text-white";

  const buttonClass = (active: boolean, disabled = false) =>
    `inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
      active ? activeClass : disabled ? disabledClass : inactiveClass
    }`;

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label={t("settings_defaultViewMode")}
    >
      <button
        type="button"
        onClick={() => onViewModeChange(ViewMode.LIVE)}
        disabled={previewOnly}
        className={buttonClass(mode === ViewMode.LIVE, previewOnly)}
        title={t("view_livePreview")}
        aria-label={t("view_livePreview")}
        aria-pressed={mode === ViewMode.LIVE}
      >
        <ModeIcon>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </ModeIcon>
      </button>

      <button
        type="button"
        onClick={() => onViewModeChange(ViewMode.PREVIEW)}
        className={buttonClass(mode === ViewMode.PREVIEW)}
        title={t("view_preview")}
        aria-label={t("view_preview")}
        aria-pressed={mode === ViewMode.PREVIEW}
      >
        <ModeIcon>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          <path d="M5 8h3" />
          <path d="M5 11h3" />
          <path d="M16 8h3" />
          <path d="M16 11h3" />
        </ModeIcon>
      </button>
    </div>
  );
};

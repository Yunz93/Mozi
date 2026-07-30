/**
 * Toolbar toggle: Source (edit) / Split / Reading (preview).
 *
 * Icons use distinct silhouettes so the three modes stay readable at toolbar size:
 * - Source: code brackets (angular)
 * - Split: dual pane with left text lines + right filled preview
 * - Reading: open book with page lines (not a flat split rectangle)
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
        onClick={() => onViewModeChange(ViewMode.EDITOR)}
        disabled={previewOnly}
        className={buttonClass(mode === ViewMode.EDITOR, previewOnly)}
        title={t("view_editorOnly")}
        aria-label={t("view_editorOnly")}
        aria-pressed={mode === ViewMode.EDITOR}
      >
        <ModeIcon>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </ModeIcon>
      </button>

      <button
        type="button"
        onClick={() => onViewModeChange(ViewMode.SPLIT)}
        disabled={previewOnly}
        className={buttonClass(mode === ViewMode.SPLIT, previewOnly)}
        title={t("view_split")}
        aria-label={t("view_split")}
        aria-pressed={mode === ViewMode.SPLIT}
      >
        <ModeIcon>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="5.5" y1="8" x2="9.5" y2="8" />
          <line x1="5.5" y1="12" x2="9.5" y2="12" />
          <line x1="5.5" y1="16" x2="8.5" y2="16" />
          <rect
            x="13.5"
            y="7"
            width="5.5"
            height="10"
            rx="1"
            fill="currentColor"
            stroke="none"
            opacity="0.4"
          />
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

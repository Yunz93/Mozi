import React from "react";
import { BookOpen, PenLine } from "lucide-react";
import { ViewMode } from "../../types";
import { useI18n } from "../../hooks/useI18n";
import { normalizeSessionViewMode } from "../../utils/viewMode";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  previewOnly?: boolean;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  viewMode,
  onViewModeChange,
  previewOnly = false,
}) => {
  const { t } = useI18n();
  const mode = normalizeSessionViewMode(viewMode);
  return (
    <div
      className="workspace-view-modes"
      role="group"
      aria-label={t("settings_defaultViewMode")}
    >
      <button
        type="button"
        onClick={() => onViewModeChange(ViewMode.LIVE)}
        disabled={previewOnly}
        className={mode === ViewMode.LIVE ? "is-active" : ""}
        title={t("view_livePreview")}
        aria-label={t("view_livePreview")}
        aria-pressed={mode === ViewMode.LIVE}
      >
        <PenLine size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange(ViewMode.PREVIEW)}
        className={mode === ViewMode.PREVIEW ? "is-active" : ""}
        title={t("view_preview")}
        aria-label={t("view_preview")}
        aria-pressed={mode === ViewMode.PREVIEW}
      >
        <BookOpen size={14} aria-hidden />
      </button>
    </div>
  );
};

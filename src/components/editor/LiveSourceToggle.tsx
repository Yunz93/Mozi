/**
 * Live-only overlay: switch between Live Preview widgets and raw Markdown source.
 * Not a third primary view mode — Reading stays a separate toolbar control.
 */

import React from "react";
import { useI18n } from "../../hooks/useI18n";
import { Icons } from "../Icon";

interface LiveSourceToggleProps {
  sourceMode: boolean;
  onToggle: () => void;
}

function PenIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export const LiveSourceToggle: React.FC<LiveSourceToggleProps> = ({
  sourceMode,
  onToggle,
}) => {
  const { t } = useI18n();
  const label = sourceMode
    ? t("editor_showLivePreview")
    : t("editor_showPlainText");

  return (
    <button
      type="button"
      className={`editor-source-toggle inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm transition-colors ${
        sourceMode
          ? "border-gray-300/80 bg-white text-gray-900 dark:border-white/15 dark:bg-gray-800 dark:text-white"
          : "border-gray-200/70 bg-white/80 text-gray-500 hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-400 dark:hover:text-white"
      }`}
      title={label}
      aria-label={label}
      aria-pressed={sourceMode}
      onClick={onToggle}
    >
      {sourceMode ? <PenIcon /> : <Icons.FileCode size={16} />}
    </button>
  );
};

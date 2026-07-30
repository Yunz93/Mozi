import React, { useCallback, useState } from "react";
import type { MetadataField } from "../../../types";
import { useI18n } from "../../../hooks/useI18n";
import type { SettingsTabProps } from "../types";

interface MetadataTabProps extends SettingsTabProps {
  keyColumnWidth: number;
  valueColumnWidth: number;
  onKeyColumnWidthChange: (width: number) => void;
  onValueColumnWidthChange: (width: number) => void;
}

function beginColumnResize(
  event: React.MouseEvent,
  startWidth: number,
  onChange: (width: number) => void,
) {
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;

  const handlePointerMove = (moveEvent: MouseEvent) => {
    onChange(startWidth + (moveEvent.clientX - startX));
  };

  const handlePointerUp = () => {
    document.removeEventListener("mousemove", handlePointerMove);
    document.removeEventListener("mouseup", handlePointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", handlePointerMove);
  document.addEventListener("mouseup", handlePointerUp);
}

export const MetadataTab: React.FC<MetadataTabProps> = ({
  settings,
  onUpdateSettings,
  keyColumnWidth,
  valueColumnWidth,
  onKeyColumnWidthChange,
  onValueColumnWidthChange,
}) => {
  const { t } = useI18n();
  const [draggingMetadataIndex, setDraggingMetadataIndex] = useState<
    number | null
  >(null);

  const handleUpdateMetadata = (idx: number, field: Partial<MetadataField>) => {
    if (idx < 0 || idx >= settings.metadataFields.length) return;
    const newFields = settings.metadataFields.map((f, i) =>
      i === idx ? { ...f, ...field } : f,
    );
    onUpdateSettings({ metadataFields: newFields });
  };

  const handleAddMetadata = () => {
    onUpdateSettings({
      metadataFields: [
        ...settings.metadataFields,
        { key: "new_prop", defaultValue: "", description: "" },
      ],
    });
  };

  const handleRemoveMetadata = (idx: number) => {
    if (idx < 0 || idx >= settings.metadataFields.length) return;
    onUpdateSettings({
      metadataFields: settings.metadataFields.filter((_, i) => i !== idx),
    });
  };

  const handleMoveMetadata = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= settings.metadataFields.length ||
      toIndex >= settings.metadataFields.length ||
      fromIndex === toIndex
    )
      return;

    const newFields = [...settings.metadataFields];
    const [movedField] = newFields.splice(fromIndex, 1);
    newFields.splice(toIndex, 0, movedField);
    onUpdateSettings({ metadataFields: newFields });
  };

  const handleKeyResizeStart = useCallback(
    (event: React.MouseEvent) => {
      beginColumnResize(event, keyColumnWidth, onKeyColumnWidthChange);
    },
    [keyColumnWidth, onKeyColumnWidthChange],
  );

  const handleValueResizeStart = useCallback(
    (event: React.MouseEvent) => {
      beginColumnResize(event, valueColumnWidth, onValueColumnWidthChange);
    },
    [onValueColumnWidthChange, valueColumnWidth],
  );

  return (
    <div className="space-y-6 animate-fade-in-02s">
      <div className="flex items-center justify-between">
        <div className="pr-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("settings_refreshFrontmatterOnSave")}
          </label>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("settings_refreshFrontmatterOnSaveDesc")}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onUpdateSettings({
              refreshFrontmatterOnSave: !settings.refreshFrontmatterOnSave,
            })
          }
          className={`w-10 h-6 rounded-full transition-colors duration-200 relative shrink-0 ${
            settings.refreshFrontmatterOnSave
              ? "bg-green-500"
              : "bg-gray-200 dark:bg-gray-700"
          }`}
          aria-pressed={settings.refreshFrontmatterOnSave}
        >
          <span
            className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 shadow-sm ${
              settings.refreshFrontmatterOnSave
                ? "translate-x-4"
                : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("settings_metadataTemplate")}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {t("settings_metadataTemplateDesc")}
            </p>
          </div>
          <button
            onClick={handleAddMetadata}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-80 dark:bg-white dark:text-black"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("settings_addField")}
          </button>
        </div>

        <div className="mb-2 hidden items-center gap-1 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 sm:flex">
          <span className="w-8 shrink-0" aria-hidden />
          <span className="shrink-0" style={{ width: keyColumnWidth }}>
            {t("settings_metadataKeyLabel")}
          </span>
          <span className="w-3 shrink-0" aria-hidden />
          <span className="w-3 shrink-0" aria-hidden />
          <span className="shrink-0" style={{ width: valueColumnWidth }}>
            {t("settings_metadataValueLabel")}
          </span>
          <span className="w-3 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("settings_metadataDescriptionLabel")}
          </span>
          <span className="w-8 shrink-0" aria-hidden />
        </div>

        <div className="space-y-2 pr-1">
          {settings.metadataFields.map((field, idx) => (
            <div
              key={`${field.key}-${idx}`}
              draggable
              onDragStart={() => setDraggingMetadataIndex(idx)}
              onDragEnd={() => setDraggingMetadataIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingMetadataIndex === null) return;
                handleMoveMetadata(draggingMetadataIndex, idx);
                setDraggingMetadataIndex(null);
              }}
              className={`group flex items-start gap-1 rounded-xl border bg-gray-50 p-2 transition-colors dark:bg-white/5 ${
                draggingMetadataIndex === idx
                  ? "border-accent-DEFAULT/50 bg-accent-DEFAULT/5"
                  : "border-gray-100 dark:border-white/5"
              }`}
            >
              <button
                type="button"
                title={t("settings_dragToReorder")}
                className="mt-1 cursor-grab p-2 text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:hover:text-gray-200"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="9" cy="6" r="1" />
                  <circle cx="15" cy="6" r="1" />
                  <circle cx="9" cy="12" r="1" />
                  <circle cx="15" cy="12" r="1" />
                  <circle cx="9" cy="18" r="1" />
                  <circle cx="15" cy="18" r="1" />
                </svg>
              </button>
              <input
                type="text"
                value={field.key}
                onChange={(e) =>
                  handleUpdateMetadata(idx, { key: e.target.value })
                }
                placeholder={t("settings_metadataKeyPlaceholder")}
                aria-label={t("settings_metadataKeyLabel")}
                title={field.key}
                className="shrink-0 rounded-lg border border-transparent bg-white px-3 py-2 text-sm transition-colors focus:border-accent-DEFAULT focus:outline-none dark:bg-black/20"
                style={{ width: keyColumnWidth }}
              />
              <button
                type="button"
                aria-label={t("settings_resizeMetadataKeyColumn")}
                title={t("settings_resizeMetadataKeyColumn")}
                className="mt-1 hidden h-8 w-3 shrink-0 cursor-col-resize items-center justify-center rounded hover:bg-black/5 md:flex dark:hover:bg-white/10"
                onMouseDown={handleKeyResizeStart}
              >
                <span className="h-4 w-px bg-gray-300 dark:bg-white/20" />
              </button>
              <span className="mt-2 text-gray-400">:</span>
              <input
                type="text"
                value={field.defaultValue}
                onChange={(e) =>
                  handleUpdateMetadata(idx, { defaultValue: e.target.value })
                }
                placeholder={t("settings_metadataValuePlaceholder")}
                aria-label={t("settings_metadataValueLabel")}
                title={field.defaultValue || t("settings_metadataNowHint")}
                className="shrink-0 rounded-lg border border-transparent bg-white px-3 py-2 text-sm transition-colors focus:border-accent-DEFAULT focus:outline-none dark:bg-black/20"
                style={{ width: valueColumnWidth }}
              />
              <button
                type="button"
                aria-label={t("settings_resizeMetadataValueColumn")}
                title={t("settings_resizeMetadataValueColumn")}
                className="mt-1 hidden h-8 w-3 shrink-0 cursor-col-resize items-center justify-center rounded hover:bg-black/5 md:flex dark:hover:bg-white/10"
                onMouseDown={handleValueResizeStart}
              >
                <span className="h-4 w-px bg-gray-300 dark:bg-white/20" />
              </button>
              <textarea
                value={field.description ?? ""}
                onChange={(e) =>
                  handleUpdateMetadata(idx, { description: e.target.value })
                }
                placeholder={t("settings_metadataDescriptionPlaceholder")}
                aria-label={t("settings_metadataDescriptionLabel")}
                title={field.description || undefined}
                rows={2}
                className="min-h-[2.75rem] min-w-0 flex-1 resize-y rounded-lg border border-transparent bg-white px-3 py-2 text-sm leading-5 transition-colors focus:border-accent-DEFAULT focus:outline-none dark:bg-black/20"
              />
              <button
                onClick={() => handleRemoveMetadata(idx)}
                className="mt-1 rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                aria-label={`Remove ${field.key}`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-1 text-xs text-gray-400">
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
          <span>
            {t("settings_metadataTip", {
              now: "{now}",
              nowDatetime: "{now:datetime}",
            })}
          </span>
        </div>
      </div>
    </div>
  );
};

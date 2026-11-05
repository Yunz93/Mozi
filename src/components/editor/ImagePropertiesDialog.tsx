import React, { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";
import {
  splitObsidianImageAlt,
  parseObsidianImageSize,
} from "../../utils/wikiLinks";
import { useImeCompositionGate } from "../../hooks/useImeCompositionGate";
import type { LocalImageMatch } from "./editorPaneHelpers";
import { MARKDOWN_IMAGE_INLINE_RE } from "../../utils/markdownInlineRanges";
import {
  buildMarkdownDestination,
  parseMarkdownDestination,
} from "../../utils/markdownDestination";

export function ImagePropertiesDialog({
  image,
  original,
  onClose,
  onSave,
}: {
  image: LocalImageMatch;
  original: string;
  onClose: () => void;
  onSave: (markdown: string) => void;
}) {
  const { t } = useI18n();
  const wiki = original.startsWith("![[");
  const destination = parseMarkdownDestination(
    new RegExp(MARKDOWN_IMAGE_INLINE_RE.source).exec(original)?.[2] ?? "",
  );
  const wikiAlias = wiki
    ? original.slice(3, -2).split("|").slice(1).join("|")
    : "";
  const wikiSize = parseObsidianImageSize(wikiAlias);
  const parsed = wiki
    ? {
        label: wikiSize ? "" : wikiAlias,
        width: wikiSize?.width,
        height: wikiSize?.height,
      }
    : splitObsidianImageAlt(image.alt);
  const [label, setLabel] = useState(parsed.label);
  const [source, setSource] = useState(image.src);
  const [width, setWidth] = useState(parsed.width ? String(parsed.width) : "");
  const [height, setHeight] = useState(
    parsed.height ? String(parsed.height) : "",
  );
  const { onCompositionStart, onCompositionEnd, isComposing } =
    useImeCompositionGate();
  const fieldClass =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-transparent text-gray-900 dark:text-gray-100 dark:border-white/15 focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t("editor_imageProperties")}
      className="max-w-md"
    >
      <form
        className="space-y-4"
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onSubmit={(event) => {
          event.preventDefault();
          if (isComposing() || !source.trim()) return;
          const size = width
            ? `|${Number(width)}${height ? `x${Number(height)}` : ""}`
            : "";
          const target = source.trim().replace(/[\r\n]/g, "");
          const alt = label.replace(/[\\[\]]/g, "\\$&");
          onSave(
            wiki &&
              (!label || !size) &&
              !/[\[\]|\r\n]/.test(target + label) &&
              !/^(?:https?:|data:|blob:)/i.test(target)
              ? `![[${target}${size || (label ? `|${label}` : "")}]]`
              : `![${alt}${size}](${buildMarkdownDestination(
                  target.replace(/>/g, "%3E"),
                  { ...destination, angleBrackets: true },
                )})`,
          );
        }}
      >
        <label className="block text-sm space-y-1">
          <span>{t("editor_imageSource")}</span>
          <input
            className={fieldClass}
            required
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>{t("editor_imageAlt")}</span>
          <input
            className={fieldClass}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm space-y-1">
            <span>{t("editor_imageWidth")}</span>
            <input
              className={fieldClass}
              type="number"
              min="1"
              max="10000"
              value={width}
              onChange={(event) => {
                setWidth(event.target.value);
                if (!event.target.value) setHeight("");
              }}
            />
          </label>
          <label className="block text-sm space-y-1">
            <span>{t("editor_imageHeight")}</span>
            <input
              className={fieldClass}
              disabled={!width}
              type="number"
              min="1"
              max="10000"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 active:translate-y-px"
          >
            {t("common_cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm bg-[var(--workspace-active)] active:translate-y-px"
          >
            {t("common_confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

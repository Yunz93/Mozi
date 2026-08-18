/**
 * Explicit Live Preview soft-off: never silently return empty decorations.
 * Heavy/large docs keep source markdown visible and show why widgets are skipped.
 */

import { EditorView, WidgetType } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import {
  isHeavyLivePreviewState,
  isLargeEditorState,
} from "../hooks/codeMirrorHelpers";
import { bindLivePreviewWidgetCaret } from "./shared";
import { useAppStore } from "../../../store/appStore";
import { t, type TranslationKey } from "../../../utils/i18n";

export type LivePreviewOptimizationMode = "normal" | "heavy" | "large";

export type SoftOffKind =
  | "table"
  | "callout"
  | "mermaid"
  | "math"
  | "image"
  | "wiki"
  | "link"
  | "formatting";

export function getLivePreviewOptimizationMode(
  state: EditorState,
): LivePreviewOptimizationMode {
  if (isLargeEditorState(state)) return "large";
  if (isHeavyLivePreviewState(state)) return "heavy";
  return "normal";
}

function softOffKindKey(kind: SoftOffKind): TranslationKey {
  switch (kind) {
    case "table":
      return "editor_softOffKind_table";
    case "callout":
      return "editor_softOffKind_callout";
    case "mermaid":
      return "editor_softOffKind_mermaid";
    case "math":
      return "editor_softOffKind_math";
    case "image":
      return "editor_softOffKind_image";
    case "wiki":
      return "editor_softOffKind_wiki";
    case "link":
      return "editor_softOffKind_link";
    default:
      return "editor_softOffKind_formatting";
  }
}

export function softOffReason(
  mode: LivePreviewOptimizationMode,
  kind: SoftOffKind,
): string | null {
  if (mode === "normal") return null;
  const language = useAppStore.getState().settings.language;
  const kindLabel = t(language, softOffKindKey(kind));
  if (mode === "large") {
    return t(language, "editor_softOffLarge", { kind: kindLabel });
  }
  if (kind === "table" || kind === "callout" || kind === "mermaid") {
    return t(language, "editor_softOffHeavy", { kind: kindLabel });
  }
  return null;
}

/** Compact block placeholder when a heavy widget is soft-off. */
export class SoftOffPlaceholderWidget extends WidgetType {
  constructor(
    readonly kind: SoftOffKind,
    readonly reason: string,
    readonly summary = "",
    readonly from: number | null = null,
  ) {
    super();
  }

  eq(other: SoftOffPlaceholderWidget) {
    return (
      this.kind === other.kind &&
      this.reason === other.reason &&
      this.summary === other.summary &&
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-preview-soft-off";
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-soft-off", this.kind);
    wrap.setAttribute("title", this.reason);

    const label = document.createElement("span");
    label.className = "cm-live-preview-soft-off-label";
    label.textContent = softOffLabel(this.kind);
    wrap.appendChild(label);

    if (this.summary.trim()) {
      const summary = document.createElement("span");
      summary.className = "cm-live-preview-soft-off-summary";
      summary.textContent = this.summary.trim();
      wrap.appendChild(summary);
    }

    const hint = document.createElement("span");
    hint.className = "cm-live-preview-soft-off-hint";
    hint.textContent = this.reason;
    wrap.appendChild(hint);

    if (this.from != null) {
      bindLivePreviewWidgetCaret(view, wrap, this.from);
    }

    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function softOffLabel(kind: SoftOffKind): string {
  const language = useAppStore.getState().settings.language;
  return t(language, softOffKindKey(kind));
}

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

export function softOffReason(
  mode: LivePreviewOptimizationMode,
  kind: SoftOffKind,
): string | null {
  if (mode === "normal") return null;
  if (mode === "large") {
    return `Large-file mode: ${kind} widgets disabled (${">"}5,000 lines or ${">"}500k chars)`;
  }
  if (kind === "table" || kind === "callout" || kind === "mermaid") {
    return `Heavy-file mode: ${kind} widgets deferred (${">"}2,000 lines or ${">"}200k chars)`;
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
  switch (kind) {
    case "table":
      return "Table";
    case "callout":
      return "Callout";
    case "mermaid":
      return "Mermaid";
    case "math":
      return "Math";
    case "image":
      return "Image";
    case "wiki":
      return "Wiki";
    case "link":
      return "Link";
    case "formatting":
      return "Formatting";
    default:
      return kind;
  }
}

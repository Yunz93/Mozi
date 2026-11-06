import { Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { hasSkipAncestor } from "../livePreview/shared";
import { livePreviewCaretAnchoringEnabled } from "../livePreview/caretAnchor";
import {
  IME_CONFIRM_SUPPRESS_MS,
  isEditorImeComposing,
} from "../behavior/imeGuard";
import { useAppStore } from "../../../store/appStore";

export interface WritingPreferences {
  focusMode?: boolean;
  typewriterMode?: boolean;
  smartPunctuation?: boolean;
}

const writingPreferences = Facet.define<WritingPreferences, WritingPreferences>(
  {
    combine: (values) => values[values.length - 1] ?? {},
  },
);

function focusDecorations(view: EditorView): DecorationSet {
  if (!view.state.facet(writingPreferences).focusMode) return Decoration.none;
  const { state } = view;
  const selection = state.selection.main;
  let from = state.doc.lineAt(selection.from).number;
  let to = state.doc.lineAt(selection.to).number;
  for (const pos of [selection.from, selection.to]) {
    let node = syntaxTree(state).resolveInner(pos, -1);
    while (node.parent) {
      if (
        node.name === "Paragraph" ||
        node.name.startsWith("ATXHeading") ||
        node.name === "FencedCode"
      ) {
        from = Math.min(from, state.doc.lineAt(node.from).number);
        to = Math.max(
          to,
          state.doc.lineAt(Math.max(node.from, node.to - 1)).number,
        );
        break;
      }
      node = node.parent;
    }
  }
  const ranges = [];
  for (const visible of view.visibleRanges) {
    const start = state.doc.lineAt(visible.from).number;
    const end = state.doc.lineAt(visible.to).number;
    for (let n = start; n <= end; n++) {
      if (n < from || n > to)
        ranges.push(
          Decoration.line({ class: "cm-writing-inactive" }).range(
            state.doc.line(n).from,
          ),
        );
    }
  }
  return Decoration.set(ranges, true);
}

export const writingView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private generation = 0;
    private followingCaret = true;
    private compositionTimer: ReturnType<typeof setTimeout> | null = null;
    private cancelManualPositioning = () => this.cancelPositioning();
    constructor(view: EditorView) {
      this.decorations = focusDecorations(view);
      // 滚动条和 gutter 位于 contentDOM 外，也必须取消跟随。
      for (const type of ["wheel", "touchstart", "mousedown"])
        view.scrollDOM.addEventListener(type, this.cancelManualPositioning, {
          passive: true,
        });
      this.view = view;
    }
    private view: EditorView;
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(writingPreferences) !==
          update.state.facet(writingPreferences)
      ) {
        this.decorations = focusDecorations(update.view);
      }
      const preferences = update.state.facet(writingPreferences);
      const previousPreferences = update.startState.facet(writingPreferences);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        preferences !== previousPreferences
      )
        this.generation++;
      const userEdit =
        update.docChanged &&
        update.transactions.some(
          (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"),
        );
      const keyboardSelection =
        update.selectionSet &&
        update.transactions.some(
          (tr) => tr.isUserEvent("select") && !tr.isUserEvent("select.pointer"),
        );
      const explicitPositioning =
        !previousPreferences.typewriterMode || userEdit || keyboardSelection;
      if (update.docChanged && !userEdit) this.cancelPositioning();
      if (explicitPositioning) this.followingCaret = true;
      if (this.compositionTimer && (update.docChanged || update.selectionSet)) {
        if (userEdit || keyboardSelection) this.finishComposition(update.view);
        else this.cancelPositioning();
      }
      if (
        preferences.typewriterMode &&
        (explicitPositioning ||
          (this.followingCaret &&
            update.geometryChanged &&
            !update.docChanged &&
            !update.selectionSet &&
            !update.viewportChanged))
      )
        this.centerCaret(update.view);
    }
    centerCaret(view: EditorView): void {
      if (
        !view.state.facet(writingPreferences).typewriterMode ||
        !this.followingCaret ||
        !view.hasFocus ||
        !view.state.selection.main.empty ||
        isEditorImeComposing(view)
      )
        return;
      const generation = this.generation;
      const head = view.state.selection.main.head;
      view.requestMeasure({
        key: this,
        read: () => {
          if (
            generation !== this.generation ||
            !this.followingCaret ||
            !view.hasFocus ||
            !view.state.facet(writingPreferences).typewriterMode ||
            isEditorImeComposing(view) ||
            view.dom.closest('[aria-hidden="true"]')
          )
            return null;
          const caret = view.coordsAtPos(head);
          const viewport = view.scrollDOM.getBoundingClientRect();
          return caret
            ? Math.max(
                0,
                view.scrollDOM.scrollTop +
                  caret.top -
                  viewport.top -
                  viewport.height * 0.45,
              )
            : null;
        },
        write: (top) => {
          if (top !== null && generation === this.generation && view.hasFocus)
            view.scrollDOM.scrollTop = top;
        },
      });
    }
    cancelPositioning(): void {
      this.generation++;
      this.followingCaret = false;
      if (this.compositionTimer) {
        clearTimeout(this.compositionTimer);
        this.compositionTimer = null;
      }
    }
    finishComposition(view: EditorView): void {
      if (this.compositionTimer) clearTimeout(this.compositionTimer);
      this.followingCaret = true;
      const generation = this.generation;
      this.compositionTimer = setTimeout(() => {
        this.compositionTimer = null;
        if (generation === this.generation) this.centerCaret(view);
      }, IME_CONFIRM_SUPPRESS_MS + 1);
    }
    destroy(): void {
      this.cancelPositioning();
      for (const type of ["wheel", "touchstart", "mousedown"])
        this.view.scrollDOM.removeEventListener(
          type,
          this.cancelManualPositioning,
        );
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventObservers: {
      compositionstart() {
        this.cancelPositioning();
      },
      compositionend(_event, view) {
        this.finishComposition(view);
      },
    },
  },
);

function smartPunctuation(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (
    !view.state.facet(writingPreferences).smartPunctuation ||
    !view.state.facet(livePreviewCaretAnchoringEnabled) ||
    text.length !== 1 ||
    from !== to ||
    isEditorImeComposing(view) ||
    hasSkipAncestor(view.state, from)
  )
    return false;
  const line = view.state.doc.lineAt(from);
  const before = view.state.doc.sliceString(line.from, from);
  if (before.endsWith("\\")) return false;
  let node = syntaxTree(view.state).resolveInner(from, -1);
  while (node.parent) {
    if (
      ["Link", "Image", "Autolink", "CodeInfo", "CodeText"].includes(node.name)
    )
      return false;
    node = node.parent;
  }
  // 未闭合的行内或块级公式也保留原始标点。
  const mathPrefix = view.state.doc
    .sliceString(Math.max(0, from - 8000), from)
    .replace(/\\\$/g, "");
  if (
    (before.replace(/\\\$/g, "").match(/(?<!\$)\$(?!\$)/g)?.length ?? 0) % 2 ||
    (mathPrefix.match(/^\s*\$\$\s*$/gm)?.length ?? 0) % 2
  )
    return false;
  let replacement = "";
  let start = from;
  if (text === '"' || text === "'") {
    const opening = !before || /[\s([{\u2014\u2013]$/.test(before);
    replacement = text === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’";
  } else if (text === "." && before.endsWith("..")) {
    start -= 2;
    replacement = "…";
  } else if (text === "-" && !/^\s*-*$/.test(before)) {
    if (before.endsWith("–")) {
      start--;
      replacement = "—";
    } else if (before.endsWith("-")) {
      start--;
      replacement = "–";
    }
  }
  if (!replacement) return false;
  view.dispatch({
    changes: { from: start, to, insert: replacement },
    selection: { anchor: start + replacement.length },
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
}

export function createWritingExperience(
  preferences: WritingPreferences,
): Extension {
  return [
    writingPreferences.of(preferences),
    EditorView.editorAttributes.of((view) => ({
      "data-writing-focus": view.state.facet(writingPreferences).focusMode
        ? "true"
        : "false",
      "data-typewriter-mode": view.state.facet(writingPreferences)
        .typewriterMode
        ? "true"
        : "false",
    })),
    writingView,
    keymap.of([
      {
        key: "F8",
        run: () => {
          const store = useAppStore.getState();
          store.updateSettings({ focusMode: !store.settings.focusMode });
          return true;
        },
      },
      {
        key: "F9",
        run: () => {
          const store = useAppStore.getState();
          store.updateSettings({
            typewriterMode: !store.settings.typewriterMode,
          });
          return true;
        },
      },
    ]),
    Prec.highest(EditorView.inputHandler.of(smartPunctuation)),
  ];
}

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
import { isEditorImeComposing } from "../behavior/imeGuard";
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

const writingView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private generation = 0;
    constructor(view: EditorView) {
      this.decorations = focusDecorations(view);
    }
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
      const generation = ++this.generation;
      if (
        !update.state.facet(writingPreferences).typewriterMode ||
        !update.view.hasFocus ||
        isEditorImeComposing(update.view) ||
        !update.docChanged ||
        !update.transactions.some(
          (tr) =>
            tr.isUserEvent("input.type") ||
            tr.isUserEvent("input.paste") ||
            tr.isUserEvent("input") ||
            tr.isUserEvent("delete"),
        )
      )
        return;
      const view = update.view;
      const head = update.state.selection.main.head;
      const scrollTop = view.scrollDOM.scrollTop;
      view.requestMeasure({
        key: this,
        read: () => {
          if (
            generation !== this.generation ||
            !view.hasFocus ||
            Math.abs(view.scrollDOM.scrollTop - scrollTop) > 1
          )
            return null;
          const caret = view.coordsAtPos(head);
          const viewport = view.scrollDOM.getBoundingClientRect();
          return caret
            ? Math.max(
                0,
                scrollTop + caret.top - viewport.top - viewport.height * 0.45,
              )
            : null;
        },
        write: (top) => {
          if (top !== null && generation === this.generation && view.hasFocus)
            view.scrollDOM.scrollTop = top;
        },
      });
    }
  },
  { decorations: (plugin) => plugin.decorations },
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

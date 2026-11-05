import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { editorCodeLanguages } from "../../../utils/editorCodeLanguages";
import { useAppStore } from "../../../store/appStore";
import { t } from "../../../utils/i18n";
import {
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
} from "./shared";

class CodeBlockControls extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly language: string,
    readonly source: string,
  ) {
    super();
  }

  eq(other: CodeBlockControls): boolean {
    return (
      this.from === other.from &&
      this.to === other.to &&
      this.language === other.language &&
      this.source === other.source
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-code-controls";
    wrap.contentEditable = "false";
    const language = useAppStore.getState().settings.language;
    const select = document.createElement("select");
    select.setAttribute("aria-label", t(language, "editor_codeLanguage"));
    const choices = new Map([
      ["", t(language, "editor_plainCode")],
      ...editorCodeLanguages.map(
        (item) =>
          [item.alias[0] ?? item.name.toLowerCase(), item.name] as [
            string,
            string,
          ],
      ),
    ]);
    if (this.language && !choices.has(this.language))
      choices.set(this.language, this.language);
    choices.forEach((label, value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.value = this.language;
    select.addEventListener("change", () => {
      const line = view.state.doc.lineAt(this.from);
      const fence = line.text.match(
        /^([\s\S]*?(?:`{3,}|~{3,}))[ \t]*([^\s`~]*)([\s\S]*)$/,
      );
      if (!fence) return;
      view.dispatch({
        changes: {
          from: line.from,
          to: line.to,
          insert: fence[1] + select.value + fence[3],
        },
        userEvent: "input.code.language",
        scrollIntoView: false,
      });
      view.focus();
    });
    wrap.append(select);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = t(language, "editor_copyCode");
    copy.addEventListener("mousedown", (event) => event.preventDefault());
    copy.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(this.source)
        .then(() => {
          if (copy.isConnected)
            copy.textContent = t(language, "editor_copiedCode");
        })
        .catch(() => {
          copy.textContent = t(language, "editor_copyCode");
        });
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = t(language, "editor_editSource");
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", () => {
      view.dispatch({
        selection: { anchor: this.from },
        scrollIntoView: false,
      });
      view.focus();
    });
    wrap.append(copy, edit);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildCodeControls(view: EditorView): DecorationSet {
  const ranges: Array<{ from: number; to: number; value: Decoration }> = [];
  const window = getLivePreviewDecorationRange(view);
  const tree = ensureLivePreviewViewportTree(view, window.to);
  tree.iterate({
    from: window.from,
    to: window.to,
    enter(node) {
      if (node.name !== "FencedCode") return;
      const first = view.state.doc.lineAt(node.from);
      const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
      const language =
        first.text.match(/(?:`{3,}|~{3,})\s*([^\s`]*)/)?.[1] ?? "";
      if (["mermaid", "mmd"].includes(language.toLowerCase())) return false;
      const marks = node.node.getChildren("CodeMark");
      const closed =
        marks.length > 1 &&
        view.state.doc.lineAt(marks[marks.length - 1].from).number ===
          last.number;
      const source = node.node
        .getChildren("CodeText")
        .map((text) => view.state.doc.sliceString(text.from, text.to))
        .join("");
      if (!selectionTouchesRange(view.state, first.from, first.to)) {
        ranges.push({
          from: first.from,
          to: first.to,
          value: Decoration.replace({
            widget: new CodeBlockControls(
              first.from,
              first.to,
              language,
              source,
            ),
          }),
        });
      }
      if (closed && !selectionTouchesRange(view.state, last.from, last.to)) {
        ranges.push({
          from: last.from,
          to: last.from,
          value: Decoration.line({ class: "cm-live-code-closing" }),
        });
        ranges.push({
          from: last.from,
          to: last.to,
          value: Decoration.replace({}),
        });
      }
      return false;
    },
  });
  ranges.sort(
    (a, b) => a.from - b.from || a.value.startSide - b.value.startSide,
  );
  const builder = new RangeSetBuilder<Decoration>();
  ranges.forEach((range) => builder.add(range.from, range.to, range.value));
  return builder.finish();
}

export const livePreviewCodeBlocks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private window = new ViewportDecorationWindow();
    constructor(view: EditorView) {
      this.decorations = buildCodeControls(view);
      this.window.mark(view);
    }
    update(update: ViewUpdate): void {
      if (shouldRebuildLivePreviewDecorations(update, "marks", this.window)) {
        this.decorations = buildCodeControls(update.view);
        this.window.mark(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

import type { SelectionRange, Text } from "@codemirror/state";
import { Facet } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const livePreviewCaretAnchoringEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

interface CaretAnchor {
  document: Text;
  head: number;
  anchor: number;
  offset: number;
  scrollTop: number;
  width: number;
  height: number;
}

class LivePreviewCaretAnchor {
  private anchor: CaretAnchor | null = null;
  private pending: {
    anchor: CaretAnchor;
    position: number;
    generation: number;
  } | null = null;
  private generation = 0;
  private disposed = false;

  constructor(readonly view: EditorView) {
    this.capture();
  }

  private readAnchor(): CaretAnchor | null {
    const { view } = this;
    if (
      this.disposed ||
      !view.state.facet(livePreviewCaretAnchoringEnabled) ||
      !view.dom.isConnected ||
      !view.hasFocus ||
      view.dom.closest('[aria-hidden="true"]')
    )
      return null;
    const selection = view.state.selection.main;
    const caret = view.coordsAtPos(selection.head);
    const viewport = view.scrollDOM.getBoundingClientRect();
    if (!caret || caret.top < viewport.top || caret.bottom > viewport.bottom)
      return null;
    return {
      document: view.state.doc,
      head: selection.head,
      anchor: selection.anchor,
      offset: caret.top - viewport.top,
      scrollTop: view.scrollDOM.scrollTop,
      width: view.scrollDOM.clientWidth,
      height: view.scrollDOM.clientHeight,
    };
  }

  capture(): void {
    if (
      this.disposed ||
      !this.view.state.facet(livePreviewCaretAnchoringEnabled)
    )
      return;
    this.view.requestMeasure({
      key: this,
      read: () => this.readAnchor(),
      write: (anchor) => {
        if (!this.disposed && !this.pending) this.anchor = anchor;
      },
    });
  }

  cancelPending(invalidateAnchor = false): void {
    this.generation += 1;
    if (invalidateAnchor) this.anchor = null;
  }

  update(update: ViewUpdate): void {
    if (update.docChanged && this.pending) {
      this.pending.position = update.changes.mapPos(this.pending.position);
    }
    if (!update.state.facet(livePreviewCaretAnchoringEnabled)) {
      this.cancelPending(true);
      return;
    }
    if (
      !update.startState.facet(livePreviewCaretAnchoringEnabled) ||
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.cancelPending();
      this.capture();
    }
  }

  private matches(anchor: CaretAnchor): boolean {
    const { view } = this;
    const selection = view.state.selection.main;
    return (
      !this.disposed &&
      view.state.facet(livePreviewCaretAnchoringEnabled) &&
      view.dom.isConnected &&
      view.hasFocus &&
      !view.dom.closest('[aria-hidden="true"]') &&
      view.state.doc === anchor.document &&
      selection.head === anchor.head &&
      selection.anchor === anchor.anchor &&
      view.scrollDOM.clientWidth === anchor.width &&
      view.scrollDOM.clientHeight === anchor.height &&
      Math.abs(view.scrollDOM.scrollTop - anchor.scrollTop) <= 1
    );
  }

  restore(): void {
    const anchor = this.anchor;
    if (!anchor || !this.matches(anchor)) return;
    this.pending = {
      anchor,
      position: anchor.head,
      generation: this.generation,
    };
    // 交给 CodeMirror 在高度图更新后定位，避免与默认的视口顶行锚定重复补偿。
    this.view.dispatch({
      effects: EditorView.scrollIntoView(anchor.head, {
        y: "start",
        yMargin: anchor.offset,
      }),
    });
  }

  handleScroll(
    range: SelectionRange,
    options: { y: string; yMargin: number },
  ): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    const isOurTarget =
      range.head === pending.position &&
      options.y === "start" &&
      options.yMargin === pending.anchor.offset;
    if (!isOurTarget) return false;
    const cancelled =
      pending.generation !== this.generation || !this.matches(pending.anchor);
    // 此时还在 CodeMirror 的测量写入阶段，等这一轮滚动完成后再记录新基线。
    queueMicrotask(() => {
      if (!this.disposed) this.anchor = this.readAnchor();
    });
    return cancelled;
  }

  destroy(): void {
    this.disposed = true;
    this.anchor = null;
    this.pending = null;
  }
}

export const livePreviewCaretAnchor = ViewPlugin.fromClass(
  LivePreviewCaretAnchor,
  {
    eventObservers: {
      scroll() {
        this.cancelPending();
        this.capture();
      },
      wheel() {
        this.cancelPending(true);
        this.capture();
      },
      touchstart() {
        this.cancelPending(true);
      },
      mousedown() {
        this.cancelPending();
      },
      keydown() {
        this.cancelPending();
      },
    },
    provide: (plugin) =>
      EditorView.scrollHandler.of(
        (view, range, options) =>
          view.plugin(plugin)?.handleScroll(range, options) ?? false,
      ),
  },
);

/** 异步布局只补偿当前可见且仍在编辑的光标，不请求焦点或改变选区。 */
export function preserveLivePreviewCaretOnLayoutChange(view: EditorView): void {
  if (view.dom.isConnected) view.plugin(livePreviewCaretAnchor)?.restore();
}

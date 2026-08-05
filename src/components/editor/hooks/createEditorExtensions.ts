/**
 * CodeMirror extension factory.
 *
 * Builds the full extension array used to initialize the markdown editor.
 * Extracted from useCodeMirror so the (large) extension wiring is separated
 * from the hook's React lifecycle. All mutable state is passed in via refs so
 * the listeners never close over stale props.
 */

import type { MutableRefObject } from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  Transaction,
} from "@codemirror/state";
import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  tooltips,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { resolveEditorCodeLanguage } from "../../../utils/editorCodeLanguages";
import { convertHtmlToMarkdown } from "../../../utils/htmlToMarkdown";
import {
  createMarkdownKeyBindings,
  getStrictOrderedListNormalizationChanges,
} from "../behavior";
import { handleStructuredPaste } from "../behavior/input";
import { markdownFenceLanguageCompletion } from "../behavior/fenceLanguageCompletion";
import { markdownFencedCodeInputHandler } from "../behavior/fencedCodeInput";
import {
  frontmatterDecorations,
  fencedCodeDecorations,
  markdownListDecorations,
  markdownHighlightStyle,
} from "../decorations";
import {
  createLivePreviewContextExtension,
  createLivePreviewPluginExtensions,
} from "../livePreview";
import type { LivePreviewContext } from "../livePreview";
import { clearPendingEditorRangeFocus } from "../../../utils/editorSelectionBridge";
import { cancelPendingLivePreviewReveals } from "../livePreview/shared";
import type { OrderedListMode, ThemeMode } from "../../../types";
import { editorAutocompletePanelBaseTheme } from "../editorAutocompleteTheme";
import type { CodeMirrorContentChangeMeta } from "./useCodeMirror";
import { getEditorTooltipSpace, isLargeEditorState } from "./codeMirrorHelpers";
import {
  type EditorPreferenceCompartments,
  type EditorPreferenceOptions,
  wrapEditorPreferenceExtensions,
} from "./editorPreferenceExtensions";

interface EditorCompartments {
  wrap: Compartment;
  placeholder: Compartment;
  keymap: Compartment;
  darkTheme: Compartment;
  markdown: Compartment;
  livePreview: Compartment;
  livePreviewContext: Compartment;
}

export interface CreateEditorExtensionsContext {
  parent: HTMLDivElement;
  themeMode: ThemeMode;
  orderedListMode: OrderedListMode;
  wordWrap: boolean;
  placeholder: string;
  livePreviewEnabled: boolean;
  livePreviewContext: LivePreviewContext;
  preferences: EditorPreferenceOptions;
  compartments: EditorCompartments;
  preferenceCompartments: EditorPreferenceCompartments;
  completionSourceRef: MutableRefObject<CompletionSource | undefined>;
  onScrollRef: MutableRefObject<(() => void) | undefined>;
  onPasteImageRef: MutableRefObject<
    ((file: File, view: EditorView) => boolean | Promise<boolean>) | undefined
  >;
  onContextMenuRef: MutableRefObject<
    ((event: MouseEvent, view: EditorView) => boolean) | undefined
  >;
  onWikiLinkStartRef: MutableRefObject<(() => void) | undefined>;
  onChangeRef: MutableRefObject<
    (content: string, meta?: CodeMirrorContentChangeMeta) => void
  >;
  convertHtmlOnPasteRef: MutableRefObject<boolean>;
  viewRef: MutableRefObject<EditorView | null>;
  isApplyingOrderedNormalizationRef: MutableRefObject<boolean>;
  normalizationTimeoutRef: MutableRefObject<number | null>;
  isSyncingContentRef: MutableRefObject<boolean>;
  changeTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingContentChangeIsLargeRef: MutableRefObject<boolean>;
  orderedListModeRef: MutableRefObject<OrderedListMode>;
  flushPendingContentChange: () => void;
}

function clipboardHasImage(event: ClipboardEvent): boolean {
  return Array.from(event.clipboardData?.items ?? []).some((item) =>
    item.type.startsWith("image/"),
  );
}

function tryConvertHtmlPaste(view: EditorView, event: ClipboardEvent): boolean {
  const html = event.clipboardData?.getData("text/html")?.trim();
  if (!html) return false;

  const markdownText = convertHtmlToMarkdown(html);
  if (!markdownText) return false;

  const selection = view.state.selection.main;
  event.preventDefault();
  view.dispatch(
    view.state.update({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: markdownText,
      },
      selection: EditorSelection.cursor(selection.from + markdownText.length),
      scrollIntoView: true,
      userEvent: "input.paste",
    }),
  );
  return true;
}

export function createEditorExtensions(
  ctx: CreateEditorExtensionsContext,
): Extension[] {
  const {
    parent,
    themeMode,
    orderedListMode,
    wordWrap,
    placeholder,
    livePreviewEnabled,
    livePreviewContext,
    preferences,
    compartments,
    preferenceCompartments,
    completionSourceRef,
    onScrollRef,
    onPasteImageRef,
    onContextMenuRef,
    onWikiLinkStartRef,
    onChangeRef,
    convertHtmlOnPasteRef,
    viewRef,
    isApplyingOrderedNormalizationRef,
    normalizationTimeoutRef,
    isSyncingContentRef,
    changeTimeoutRef,
    pendingContentChangeIsLargeRef,
    orderedListModeRef,
    flushPendingContentChange,
  } = ctx;

  const customCompletion: CompletionSource = (cmCtx: CompletionContext) => {
    const fence = markdownFenceLanguageCompletion(cmCtx);
    if (fence) return fence;
    return completionSourceRef.current?.(cmCtx) ?? null;
  };

  return [
    history(),
    compartments.darkTheme.of(EditorView.darkTheme.of(themeMode === "dark")),
    editorAutocompletePanelBaseTheme,
    EditorView.inputHandler.of(markdownFencedCodeInputHandler),
    keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
    compartments.keymap.of(
      Prec.high(keymap.of(createMarkdownKeyBindings(orderedListMode))),
    ),
    autocompletion({
      activateOnTyping: true,
      override: [customCompletion],
      maxRenderedOptions: 40,
      tooltipClass: () => "editor-autocomplete-panel",
    }),
    tooltips({
      parent,
      position: "absolute",
      tooltipSpace: getEditorTooltipSpace,
    }),
    ...wrapEditorPreferenceExtensions(preferenceCompartments, preferences),
    compartments.markdown.of(
      markdown({
        base: markdownLanguage,
        codeLanguages: resolveEditorCodeLanguage,
      }),
    ),
    drawSelection(),
    frontmatterDecorations,
    fencedCodeDecorations,
    markdownListDecorations,
    compartments.livePreview.of(
      livePreviewEnabled ? createLivePreviewPluginExtensions() : [],
    ),
    compartments.livePreviewContext.of(
      createLivePreviewContextExtension(livePreviewContext),
    ),
    compartments.wrap.of(wordWrap ? EditorView.lineWrapping : []),
    syntaxHighlighting(markdownHighlightStyle),
    compartments.placeholder.of(cmPlaceholder(placeholder)),
    EditorView.domEventHandlers({
      mousedown: () => {
        // User intent wins over stale outline/search focus requests and
        // deferred Live Preview image/wiki click-to-reveal selections.
        clearPendingEditorRangeFocus();
        cancelPendingLivePreviewReveals();
        return false;
      },
      scroll: (() => {
        // 每帧合并多次 scroll，避免时间节流丢掉末次位置导致分屏联动偶发不同步
        let rafScheduled = false;
        return () => {
          if (rafScheduled) return false;
          rafScheduled = true;
          requestAnimationFrame(() => {
            rafScheduled = false;
            const scrollHandler = onScrollRef.current;
            if (scrollHandler) {
              scrollHandler();
            }
          });
          return false;
        };
      })(),
      paste: (event, view) => {
        // Handle image paste first
        const pasteImage = onPasteImageRef.current;
        if (pasteImage && clipboardHasImage(event)) {
          const clipboardItems = Array.from(event.clipboardData?.items ?? []);
          const imageItem = clipboardItems.find((item) =>
            item.type.startsWith("image/"),
          );
          const imageFile = imageItem?.getAsFile();

          if (imageFile) {
            event.preventDefault();
            void pasteImage(imageFile, view);
            return true;
          }
        }

        if (convertHtmlOnPasteRef.current && tryConvertHtmlPaste(view, event)) {
          return true;
        }

        if (handleStructuredPaste(view, event)) {
          return true;
        }

        return false;
      },
      contextmenu: (event, view) => {
        const handler = onContextMenuRef.current;
        return handler ? handler(event, view) : false;
      },
      blur: () => {
        flushPendingContentChange();
        return false;
      },
      keydown: (event) => {
        const isSaveShortcut =
          (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
        if (isSaveShortcut) {
          flushPendingContentChange();
        }
        return false;
      },
    }),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;

      // Handle strict ordered list normalization - debounced for performance
      // Read mode from ref: updateListener is created once at editor init and must not close over a stale prop.
      if (
        orderedListModeRef.current === "strict" &&
        !isApplyingOrderedNormalizationRef.current
      ) {
        // Only normalize on user input events, not on programmatic changes
        const isUserInput = update.transactions.some(
          (t) => t.isUserEvent("input") || t.isUserEvent("delete"),
        );
        if (isUserInput) {
          // Use debounced normalization to avoid blocking during typing
          if (normalizationTimeoutRef.current) {
            clearTimeout(normalizationTimeoutRef.current);
          }
          normalizationTimeoutRef.current = window.setTimeout(() => {
            const view = viewRef.current;
            if (!view || isApplyingOrderedNormalizationRef.current) return;
            if (isLargeEditorState(view.state)) {
              normalizationTimeoutRef.current = null;
              return;
            }

            const normalizationChanges =
              getStrictOrderedListNormalizationChanges(view.state);
            if (normalizationChanges) {
              isApplyingOrderedNormalizationRef.current = true;
              view.dispatch({
                changes: normalizationChanges,
                annotations: Transaction.addToHistory.of(false),
                userEvent: "input",
              });
              isApplyingOrderedNormalizationRef.current = false;
            }
            normalizationTimeoutRef.current = null;
          }, 150); // 150ms debounce
        }
      }

      // Trigger content change
      if (!isSyncingContentRef.current) {
        if (changeTimeoutRef.current) {
          clearTimeout(changeTimeoutRef.current);
        }

        const isLarge = isLargeEditorState(update.state);
        pendingContentChangeIsLargeRef.current = isLarge;
        changeTimeoutRef.current = setTimeout(
          () => {
            const view = viewRef.current;
            if (view && !isSyncingContentRef.current) {
              const shouldSkipHistory =
                pendingContentChangeIsLargeRef.current ||
                isLargeEditorState(view.state);
              pendingContentChangeIsLargeRef.current = false;
              onChangeRef.current(view.state.doc.toString(), {
                skipHistory: shouldSkipHistory,
              });
            }
            changeTimeoutRef.current = null;
          },
          isLarge ? 240 : 16,
        );
      }

      // Auto-trigger completion for wiki links
      const wikiLinkStart = onWikiLinkStartRef.current;
      if (wikiLinkStart) {
        const selection = update.state.selection.main;
        if (selection.empty) {
          const cursor = selection.from;
          const prevTwoChars = update.state.doc.sliceString(
            Math.max(0, cursor - 2),
            cursor,
          );
          const prevOneChar = update.state.doc.sliceString(
            Math.max(0, cursor - 1),
            cursor,
          );
          if (prevTwoChars === "[[" || prevOneChar === "#") {
            wikiLinkStart();
          }
        }
      }
    }),
  ];
}

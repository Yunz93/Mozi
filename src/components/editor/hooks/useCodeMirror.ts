/**
 * CodeMirror 编辑器核心 Hook
 *
 * 负责：
 * 1. 编辑器实例的创建和销毁
 * 2. 扩展配置管理
 * 3. 内容变更监听
 * 4. 基本事件处理
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { type CompletionSource } from "@codemirror/autocomplete";
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { resolveEditorCodeLanguage } from "../../../utils/editorCodeLanguages";
import { extractMarkdownFenceLanguages } from "../../../utils/shikiLanguages";
import { createMarkdownKeyBindings } from "../behavior";
import type { OrderedListMode, ThemeMode } from "../../../types";
import { createEditorExtensions } from "./createEditorExtensions";
import {
  getDocumentReplacementRange,
  getEditorTooltipSpace,
  isLargeEditorState,
} from "./codeMirrorHelpers";
import {
  buildEditorPreferenceEffects,
  createEditorPreferenceCompartments,
  type EditorPreferenceOptions,
} from "./editorPreferenceExtensions";
import {
  createLivePreviewContextExtension,
  createLivePreviewPluginExtensions,
} from "../livePreview";
import type { LivePreviewContext } from "../livePreview";
import { EMPTY_LIVE_PREVIEW_CONTEXT } from "../livePreview";
import { scheduleLivePreviewMeasure } from "../livePreview/shared";

export { getEditorTooltipSpace };

export interface CodeMirrorContentChangeMeta {
  skipHistory?: boolean;
}

export interface UseCodeMirrorOptions {
  content: string;
  documentKey?: string | null;
  placeholder?: string;
  wordWrap?: boolean;
  orderedListMode?: OrderedListMode;
  /** 与 html.dark / 应用主题一致，供补全浮层等 CodeMirror 主题作用域使用 */
  themeMode?: ThemeMode;
  /** Obsidian-style inline live preview (hide marks when inactive). */
  livePreviewEnabled?: boolean;
  livePreviewContext?: LivePreviewContext;
  autoPairBrackets?: boolean;
  autoPairMarkdown?: boolean;
  showLineNumbers?: boolean;
  enableFolding?: boolean;
  tabSize?: number;
  useTabs?: boolean;
  showIndentationGuides?: boolean;
  spellcheck?: boolean;
  convertHtmlOnPaste?: boolean;
  onChange: (content: string, meta?: CodeMirrorContentChangeMeta) => void;
  onScroll?: () => void;
  completionSource?: CompletionSource;
  onPasteImage?: (file: File, view: EditorView) => boolean | Promise<boolean>;
  onWikiLinkStart?: () => void;
  onContextMenu?: (event: MouseEvent, view: EditorView) => boolean;
}

export interface UseCodeMirrorReturn {
  editorRef: (element: HTMLDivElement | null) => void;
  view: EditorView | null;
  focus: () => void;
  setWordWrap: (enabled: boolean) => void;
  setPlaceholder: (text: string) => void;
  setOrderedListMode: (mode: OrderedListMode) => void;
  /** Push any debounced content change to onChange immediately. */
  flushPendingContentChange: () => void;
}

const DEFAULT_PREFERENCES: EditorPreferenceOptions = {
  autoPairBrackets: true,
  autoPairMarkdown: true,
  showLineNumbers: false,
  enableFolding: false,
  tabSize: 4,
  useTabs: false,
  showIndentationGuides: false,
  spellcheck: false,
};

export function useCodeMirror(
  options: UseCodeMirrorOptions,
): UseCodeMirrorReturn {
  const {
    content,
    documentKey = null,
    placeholder = "在此输入...",
    wordWrap = true,
    orderedListMode = "strict",
    themeMode = "light",
    livePreviewEnabled = false,
    livePreviewContext = EMPTY_LIVE_PREVIEW_CONTEXT,
    autoPairBrackets = DEFAULT_PREFERENCES.autoPairBrackets,
    autoPairMarkdown = DEFAULT_PREFERENCES.autoPairMarkdown,
    showLineNumbers = DEFAULT_PREFERENCES.showLineNumbers,
    enableFolding = DEFAULT_PREFERENCES.enableFolding,
    tabSize = DEFAULT_PREFERENCES.tabSize,
    useTabs = DEFAULT_PREFERENCES.useTabs,
    showIndentationGuides = DEFAULT_PREFERENCES.showIndentationGuides,
    spellcheck = DEFAULT_PREFERENCES.spellcheck,
    convertHtmlOnPaste = true,
    onChange,
    onScroll,
    completionSource,
    onPasteImage,
    onWikiLinkStart,
    onContextMenu,
  } = options;

  const preferences = useMemo<EditorPreferenceOptions>(
    () => ({
      autoPairBrackets,
      autoPairMarkdown,
      showLineNumbers,
      enableFolding,
      tabSize,
      useTabs,
      showIndentationGuides,
      spellcheck,
    }),
    [
      autoPairBrackets,
      autoPairMarkdown,
      showLineNumbers,
      enableFolding,
      tabSize,
      useTabs,
      showIndentationGuides,
      spellcheck,
    ],
  );

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const [editorElementReady, setEditorElementReady] = useState(false);
  const [markdownLanguageRevision, setMarkdownLanguageRevision] = useState(0);
  const changeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isApplyingOrderedNormalizationRef = useRef(false);
  const normalizationTimeoutRef = useRef<number | null>(null);
  const restoreScrollFrameRef = useRef<number | null>(null);
  const completionSourceRef = useRef(completionSource);
  const onChangeRef = useRef(onChange);
  const onScrollRef = useRef(onScroll);
  const onPasteImageRef = useRef(onPasteImage);
  const onWikiLinkStartRef = useRef(onWikiLinkStart);
  const onContextMenuRef = useRef(onContextMenu);
  const convertHtmlOnPasteRef = useRef(convertHtmlOnPaste);
  const loadedMarkdownLanguageKeysRef = useRef<Set<string>>(new Set());
  const pendingContentChangeIsLargeRef = useRef(false);
  const orderedListModeRef = useRef(orderedListMode);

  // Compartments for dynamic reconfiguration
  const compartments = useMemo(
    () => ({
      wrap: new Compartment(),
      placeholder: new Compartment(),
      keymap: new Compartment(),
      darkTheme: new Compartment(),
      markdown: new Compartment(),
      livePreview: new Compartment(),
      livePreviewContext: new Compartment(),
    }),
    [],
  );
  const preferenceCompartments = useMemo(
    () => createEditorPreferenceCompartments(),
    [],
  );

  // Track if we're currently syncing content to avoid loops
  const isSyncingContentRef = useRef(false);
  const previousDocumentKeyRef = useRef<string | null>(documentKey);
  const editorExtensionsRef = useRef<Extension[]>([]);
  const editorStateCacheRef = useRef<Map<string, EditorState>>(new Map());

  // Track initial content for delayed initialization
  const initialContentRef = useRef(content || "");

  // Update initial content ref when content changes before initialization
  useEffect(() => {
    if (!viewRef.current) {
      initialContentRef.current = content || "";
    }
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.placeholder.reconfigure(cmPlaceholder(placeholder)),
    });
  }, [compartments.placeholder, placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.wrap.reconfigure(
        wordWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [compartments.wrap, wordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({
      effects: compartments.livePreview.reconfigure(
        livePreviewEnabled ? createLivePreviewPluginExtensions() : [],
      ),
    });
    // Remounting widgets changes document height; keep the user's place.
    view.scrollDOM.scrollTop = scrollTop;
    if (livePreviewEnabled) {
      scheduleLivePreviewMeasure(view);
      if (typeof document !== "undefined" && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (viewRef.current === view && view.dom.isConnected) {
            scheduleLivePreviewMeasure(view);
          }
        });
      }
    }
  }, [compartments.livePreview, livePreviewEnabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.livePreviewContext.reconfigure(
        createLivePreviewContextExtension(livePreviewContext),
      ),
    });
  }, [compartments.livePreviewContext, livePreviewContext]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.keymap.reconfigure(
        Prec.high(keymap.of(createMarkdownKeyBindings(orderedListMode))),
      ),
    });
  }, [compartments.keymap, orderedListMode]);

  useEffect(() => {
    orderedListModeRef.current = orderedListMode;
    if (
      orderedListMode !== "strict" &&
      normalizationTimeoutRef.current !== null
    ) {
      clearTimeout(normalizationTimeoutRef.current);
      normalizationTimeoutRef.current = null;
    }
  }, [orderedListMode]);

  useEffect(() => {
    convertHtmlOnPasteRef.current = convertHtmlOnPaste;
  }, [convertHtmlOnPaste]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: buildEditorPreferenceEffects(
        preferenceCompartments,
        preferences,
      ),
    });
  }, [preferenceCompartments, preferences]);

  // Callback ref to track when editor element is mounted
  const setEditorElement = useCallback((element: HTMLDivElement | null) => {
    editorRef.current = element;
    if (element && !viewRef.current) {
      setEditorElementReady(true);
    } else if (!element) {
      setEditorElementReady(false);
    }
  }, []);

  useEffect(() => {
    completionSourceRef.current = completionSource;
  }, [completionSource]);

  useEffect(() => {
    onScrollRef.current = onScroll;
  }, [onScroll]);

  useEffect(() => {
    onPasteImageRef.current = onPasteImage;
  }, [onPasteImage]);

  useEffect(() => {
    onWikiLinkStartRef.current = onWikiLinkStart;
  }, [onWikiLinkStart]);

  useEffect(() => {
    onContextMenuRef.current = onContextMenu;
  }, [onContextMenu]);

  const flushPendingContentChange = useCallback(() => {
    if (changeTimeoutRef.current) {
      clearTimeout(changeTimeoutRef.current);
      changeTimeoutRef.current = null;
    }

    const view = viewRef.current;
    if (!view || isSyncingContentRef.current) return;

    const isLarge =
      pendingContentChangeIsLargeRef.current || isLargeEditorState(view.state);
    pendingContentChangeIsLargeRef.current = false;
    onChangeRef.current(view.state.doc.toString(), { skipHistory: isLarge });
  }, []);

  useEffect(() => {
    if (onChangeRef.current !== onChange && changeTimeoutRef.current) {
      flushPendingContentChange();
    }
    onChangeRef.current = onChange;
  }, [flushPendingContentChange, onChange]);

  useEffect(() => {
    const missingDescriptions = extractMarkdownFenceLanguages(content)
      .map((lang) => ({
        key: lang,
        description: resolveEditorCodeLanguage(lang),
      }))
      .filter(
        (
          entry,
        ): entry is {
          key: string;
          description: NonNullable<
            ReturnType<typeof resolveEditorCodeLanguage>
          >;
        } =>
          Boolean(entry.description) &&
          !loadedMarkdownLanguageKeysRef.current.has(entry.key),
      );

    if (missingDescriptions.length === 0) {
      return;
    }

    let cancelled = false;

    void Promise.all(
      missingDescriptions.map(async ({ key, description }) => {
        await description.load();
        if (!cancelled) {
          loadedMarkdownLanguageKeysRef.current.add(key);
        }
      }),
    )
      .then(() => {
        if (!cancelled) {
          setMarkdownLanguageRevision((prev) => prev + 1);
        }
      })
      .catch((error) => {
        console.warn(
          "Failed to preload markdown fenced code languages:",
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.darkTheme.reconfigure(
        EditorView.darkTheme.of(themeMode === "dark"),
      ),
    });
  }, [themeMode, compartments.darkTheme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.markdown.reconfigure(
        markdown({
          base: markdownLanguage,
          codeLanguages: resolveEditorCodeLanguage,
        }),
      ),
    });
  }, [compartments.markdown, markdownLanguageRevision]);

  // Initialize editor as soon as the DOM node is ready.
  useLayoutEffect(() => {
    if (!editorElementReady || !editorRef.current || viewRef.current) return;

    try {
      const extensions = createEditorExtensions({
        parent: editorRef.current,
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
      });
      editorExtensionsRef.current = extensions;

      const cachedState =
        documentKey != null
          ? editorStateCacheRef.current.get(documentKey)
          : undefined;
      const view = new EditorView({
        state:
          cachedState ??
          EditorState.create({
            doc: initialContentRef.current,
            extensions,
          }),
        parent: editorRef.current,
      });

      viewRef.current = view;
      setViewReady(true);
    } catch (error) {
      console.error("CodeMirror initialization failed:", error);
    }

    return () => {
      flushPendingContentChange();
      if (changeTimeoutRef.current) {
        clearTimeout(changeTimeoutRef.current);
        changeTimeoutRef.current = null;
      }
      if (normalizationTimeoutRef.current) {
        clearTimeout(normalizationTimeoutRef.current);
      }
      if (restoreScrollFrameRef.current !== null) {
        cancelAnimationFrame(restoreScrollFrameRef.current);
        restoreScrollFrameRef.current = null;
      }
      const view = viewRef.current;
      if (view) {
        const key = previousDocumentKeyRef.current;
        if (key) {
          editorStateCacheRef.current.set(key, view.state);
        }
        view.destroy();
      }
      viewRef.current = null;
      setViewReady(false);
    };
  }, [compartments.markdown, editorElementReady, flushPendingContentChange]);

  // Sync external content changes (only when not typing)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const safeContent = content || "";
    const currentContent = view.state.doc.toString();
    const previousKey = previousDocumentKeyRef.current;
    const isDocumentSwitch = previousKey !== documentKey;

    if (isDocumentSwitch) {
      // Pending edits are flushed by the onChange-identity effect before this
      // sync runs, so the cached state already includes the latest keystrokes.
      if (previousKey) {
        editorStateCacheRef.current.set(previousKey, view.state);
      }

      const cachedState =
        documentKey != null
          ? editorStateCacheRef.current.get(documentKey)
          : undefined;

      isSyncingContentRef.current = true;
      if (cachedState) {
        view.setState(cachedState);
        if (view.state.doc.toString() !== safeContent) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: safeContent,
            },
            annotations: [Transaction.addToHistory.of(false)],
            scrollIntoView: false,
          });
        }
      } else {
        view.setState(
          EditorState.create({
            doc: safeContent,
            extensions: editorExtensionsRef.current,
          }),
        );
      }

      // Re-apply live compartments so restored states pick up current theme/wrap.
      const scrollTop = view.scrollDOM.scrollTop;
      view.dispatch({
        effects: [
          compartments.darkTheme.reconfigure(
            EditorView.darkTheme.of(themeMode === "dark"),
          ),
          compartments.wrap.reconfigure(
            wordWrap ? EditorView.lineWrapping : [],
          ),
          compartments.livePreview.reconfigure(
            livePreviewEnabled ? createLivePreviewPluginExtensions() : [],
          ),
          compartments.livePreviewContext.reconfigure(
            createLivePreviewContextExtension(livePreviewContext),
          ),
          compartments.keymap.reconfigure(
            Prec.high(keymap.of(createMarkdownKeyBindings(orderedListMode))),
          ),
          compartments.placeholder.reconfigure(cmPlaceholder(placeholder)),
          ...buildEditorPreferenceEffects(preferenceCompartments, preferences),
        ],
      });
      view.scrollDOM.scrollTop = scrollTop;

      isSyncingContentRef.current = false;
      previousDocumentKeyRef.current = documentKey;
      return;
    }

    if (currentContent === safeContent) return;

    if (restoreScrollFrameRef.current !== null) {
      cancelAnimationFrame(restoreScrollFrameRef.current);
      restoreScrollFrameRef.current = null;
    }

    const scrollDom = view.scrollDOM;
    const previousScrollTop = scrollDom.scrollTop;
    const previousScrollLeft = scrollDom.scrollLeft;
    const shouldRestoreFocus = view.hasFocus;

    isSyncingContentRef.current = true;
    const replacement = getDocumentReplacementRange(
      currentContent,
      safeContent,
    );
    view.dispatch({
      changes: replacement,
      scrollIntoView: false,
    });

    const restoreScrollPosition = () => {
      const maxScrollTop = Math.max(
        0,
        scrollDom.scrollHeight - scrollDom.clientHeight,
      );
      const maxScrollLeft = Math.max(
        0,
        scrollDom.scrollWidth - scrollDom.clientWidth,
      );
      scrollDom.scrollTo({
        top: Math.min(previousScrollTop, maxScrollTop),
        left: Math.min(previousScrollLeft, maxScrollLeft),
      });
    };

    restoreScrollPosition();
    restoreScrollFrameRef.current = requestAnimationFrame(() => {
      restoreScrollFrameRef.current = null;
      restoreScrollPosition();
      if (shouldRestoreFocus && !view.hasFocus) {
        view.contentDOM.focus({ preventScroll: true });
      }
    });

    isSyncingContentRef.current = false;
    previousDocumentKeyRef.current = documentKey;
  }, [
    content,
    documentKey,
    compartments.darkTheme,
    compartments.wrap,
    compartments.livePreview,
    compartments.livePreviewContext,
    compartments.keymap,
    compartments.placeholder,
    preferenceCompartments,
    preferences,
    themeMode,
    wordWrap,
    livePreviewEnabled,
    livePreviewContext,
    orderedListMode,
    placeholder,
  ]);

  // Update word wrap
  const setWordWrap = useCallback(
    (enabled: boolean) => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: compartments.wrap.reconfigure(
          enabled ? EditorView.lineWrapping : [],
        ),
      });
    },
    [compartments],
  );

  // Update placeholder
  const setPlaceholder = useCallback(
    (text: string) => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: compartments.placeholder.reconfigure(cmPlaceholder(text)),
      });
    },
    [compartments],
  );

  // Update ordered list mode
  const setOrderedListMode = useCallback(
    (mode: OrderedListMode) => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: compartments.keymap.reconfigure(
          Prec.high(keymap.of(createMarkdownKeyBindings(mode))),
        ),
      });
    },
    [compartments],
  );

  // Focus editor
  const focus = useCallback(() => {
    viewRef.current?.focus();
  }, []);

  // Use viewReady to trigger re-render when view is created
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  viewReady;

  return {
    editorRef: setEditorElement,
    view: viewRef.current,
    focus,
    setWordWrap,
    setPlaceholder,
    setOrderedListMode,
    flushPendingContentChange,
  };
}

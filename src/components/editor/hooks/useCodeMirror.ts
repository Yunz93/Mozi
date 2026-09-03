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
import { resolveEditorCodeLanguage } from "../../../utils/editorCodeLanguages";
import { createEditorMarkdownLanguage } from "../editorMarkdown";
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
import {
  LIVE_PREVIEW_LAYOUT_SETTLE_MS,
  requestLivePreviewRefresh,
  scheduleLivePreviewMeasure,
} from "../livePreview/shared";
import { isEditorImeComposing } from "../behavior/imeGuard";

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
  // 记录编辑器最后一次上报给 store 的内容，用来识别"store → props → 编辑器"的回声，
  // 避免防抖窗口内的新键入被旧 prop 覆盖。
  const lastEmittedContentRef = useRef(content || "");

  // 文档切换时需要用最新的外观/偏好重配置 compartment，但这些选项不应触发内容回灌，
  // 因此在每次渲染时同步到 ref，而不放进内容同步 effect 的 deps 里。
  const themeModeRef = useRef(themeMode);
  const wordWrapRef = useRef(wordWrap);
  const livePreviewEnabledRef = useRef(livePreviewEnabled);
  const livePreviewContextRef = useRef(livePreviewContext);
  const placeholderRef = useRef(placeholder);
  const preferencesRef = useRef(preferences);
  themeModeRef.current = themeMode;
  wordWrapRef.current = wordWrap;
  livePreviewEnabledRef.current = livePreviewEnabled;
  livePreviewContextRef.current = livePreviewContext;
  placeholderRef.current = placeholder;
  preferencesRef.current = preferences;

  // IME 组合期间收到的外部内容，等 compositionend 后再应用
  const pendingImeContentSyncRef = useRef<string | null>(null);
  const imeSyncListenerScheduledRef = useRef(false);

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
    if (!livePreviewEnabled) return undefined;
    scheduleLivePreviewMeasure(view);
    requestLivePreviewRefresh(view);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (viewRef.current === view && view.dom.isConnected) {
          scheduleLivePreviewMeasure(view);
        }
      });
    }
    const settleTimer = window.setTimeout(() => {
      if (viewRef.current !== view || !view.dom.isConnected) return;
      requestLivePreviewRefresh(view);
    }, LIVE_PREVIEW_LAYOUT_SETTLE_MS);
    return () => window.clearTimeout(settleTimer);
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
    const emitted = view.state.doc.toString();
    lastEmittedContentRef.current = emitted;
    onChangeRef.current(emitted, { skipHistory: isLarge });
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
        createEditorMarkdownLanguage(),
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
        lastEmittedContentRef,
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

    // 真正的外部内容变化（AI 应用、磁盘重载、store 撤销）才走这里回灌编辑器；
    // 可能被 IME 延后调用，所以所有状态都在调用时重新读取。
    const performExternalContentSync = (safeToApply: string) => {
      const viewNow = viewRef.current;
      if (!viewNow || viewNow !== view) return;
      if (safeToApply === lastEmittedContentRef.current) return;

      const currentNow = viewNow.state.doc.toString();
      if (currentNow === safeToApply) {
        lastEmittedContentRef.current = safeToApply;
        return;
      }

      if (restoreScrollFrameRef.current !== null) {
        cancelAnimationFrame(restoreScrollFrameRef.current);
        restoreScrollFrameRef.current = null;
      }

      const scrollDom = viewNow.scrollDOM;
      const previousScrollTop = scrollDom.scrollTop;
      const previousScrollLeft = scrollDom.scrollLeft;
      const shouldRestoreFocus = viewNow.hasFocus;

      isSyncingContentRef.current = true;
      const replacement = getDocumentReplacementRange(currentNow, safeToApply);
      viewNow.dispatch({
        changes: replacement,
        scrollIntoView: false,
        annotations: [Transaction.addToHistory.of(false)],
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
        if (shouldRestoreFocus && !viewNow.hasFocus) {
          viewNow.contentDOM.focus({ preventScroll: true });
        }
      });

      isSyncingContentRef.current = false;
      // 回灌后编辑器与 store 一致，以此为新的基线；之后 store 若再回到更早的值
      //（例如 store 级撤销）也能被识别为外部变化。
      lastEmittedContentRef.current = safeToApply;
      previousDocumentKeyRef.current = documentKey;
    };

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
            EditorView.darkTheme.of(themeModeRef.current === "dark"),
          ),
          compartments.wrap.reconfigure(
            wordWrapRef.current ? EditorView.lineWrapping : [],
          ),
          compartments.livePreview.reconfigure(
            livePreviewEnabledRef.current
              ? createLivePreviewPluginExtensions()
              : [],
          ),
          compartments.livePreviewContext.reconfigure(
            createLivePreviewContextExtension(livePreviewContextRef.current),
          ),
          compartments.keymap.reconfigure(
            Prec.high(
              keymap.of(createMarkdownKeyBindings(orderedListModeRef.current)),
            ),
          ),
          compartments.placeholder.reconfigure(
            cmPlaceholder(placeholderRef.current),
          ),
          ...buildEditorPreferenceEffects(
            preferenceCompartments,
            preferencesRef.current,
          ),
        ],
      });
      view.scrollDOM.scrollTop = scrollTop;

      isSyncingContentRef.current = false;
      previousDocumentKeyRef.current = documentKey;
      lastEmittedContentRef.current = safeContent;
      pendingImeContentSyncRef.current = null;
      imeSyncListenerScheduledRef.current = false;
      return;
    }

    // prop 只是编辑器自己刚上报内容的回声（防抖竞态）：编辑器里可能已有更新的键入，
    // 直接忽略，绝不能用旧值覆盖。
    if (safeContent === lastEmittedContentRef.current) return;
    if (currentContent === safeContent) return;

    // IME 组合中不能改文档，否则会打断候选窗；等组合结束后再应用最新的外部内容。
    if (isEditorImeComposing(view)) {
      pendingImeContentSyncRef.current = safeContent;
      if (!imeSyncListenerScheduledRef.current) {
        imeSyncListenerScheduledRef.current = true;
        view.dom.addEventListener(
          "compositionend",
          () => {
            imeSyncListenerScheduledRef.current = false;
            // CodeMirror 自己也在 compositionend 里收尾，延后一拍再 dispatch，避免嵌套更新。
            window.setTimeout(() => {
              const next = pendingImeContentSyncRef.current;
              pendingImeContentSyncRef.current = null;
              if (next != null) performExternalContentSync(next);
            }, 0);
          },
          { once: true },
        );
      }
      return;
    }

    performExternalContentSync(safeContent);
    // compartments / preferenceCompartments 由 useMemo 固定，放进 deps 不会触发多余回灌；
    // 主题、换行、偏好等外观选项则刻意通过 ref 读取，避免它们变化时重放文档替换。
  }, [content, documentKey, compartments, preferenceCompartments]);

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

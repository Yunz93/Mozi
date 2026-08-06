import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "../../../hooks/useI18n";
import { renderMermaidDiagrams } from "../../../utils/markdown-extensions";
import {
  applyHtmlPreviewZoom,
  clampHtmlPreviewZoom,
  computeHtmlPreviewFitZoom,
  ensureHtmlPreviewMermaidStyles,
  isHtmlPreviewZoomModifier,
  measureHtmlPreviewContentSize,
  nextHtmlPreviewZoom,
  normalizeMermaidPlaceholdersInDocument,
} from "./htmlPreviewEnhance";

export interface HtmlPreviewFrameProps {
  srcDoc: string;
  title: string;
  themeMode: "light" | "dark";
}

type ZoomMode = "fit" | "manual";

function bindWheelZoomTarget(
  target: EventTarget | null | undefined,
  onWheel: (event: WheelEvent) => void,
): (() => void) | null {
  if (!target || typeof (target as Window).addEventListener !== "function") {
    return null;
  }
  target.addEventListener("wheel", onWheel as EventListener, {
    passive: false,
    capture: true,
  });
  return () => {
    target.removeEventListener("wheel", onWheel as EventListener, true);
  };
}

export const HtmlPreviewFrame: React.FC<HtmlPreviewFrameProps> = ({
  srcDoc,
  title,
  themeMode,
}) => {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [manualZoom, setManualZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [ready, setReady] = useState(false);

  const zoomModeRef = useRef(zoomMode);
  const manualZoomRef = useRef(manualZoom);
  const fitZoomRef = useRef(fitZoom);

  useEffect(() => {
    zoomModeRef.current = zoomMode;
  }, [zoomMode]);
  useEffect(() => {
    manualZoomRef.current = manualZoom;
  }, [manualZoom]);
  useEffect(() => {
    fitZoomRef.current = fitZoom;
  }, [fitZoom]);

  const displayZoom =
    zoomMode === "fit" ? fitZoom : clampHtmlPreviewZoom(manualZoom);

  const syncZoomIntoIframe = useCallback((nextZoom: number) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    applyHtmlPreviewZoom(doc, nextZoom);
  }, []);

  const recomputeFitZoom = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.documentElement) return 1;

    const { width, height } = measureHtmlPreviewContentSize(doc);
    const next = computeHtmlPreviewFitZoom(
      width,
      height,
      iframe.clientWidth,
      iframe.clientHeight,
    );
    setFitZoom(next);
    fitZoomRef.current = next;
    return next;
  }, []);

  const enhanceIframeDocument = useCallback(async () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) {
      setReady(false);
      return;
    }

    ensureHtmlPreviewMermaidStyles(doc);
    normalizeMermaidPlaceholdersInDocument(doc);

    // Render Mermaid at zoom=1 so layout width is meaningful.
    applyHtmlPreviewZoom(doc, 1);
    await renderMermaidDiagrams(doc.body, { themeMode });

    const fitted = recomputeFitZoom();
    setZoomMode("fit");
    zoomModeRef.current = "fit";
    applyHtmlPreviewZoom(doc, fitted);
    setReady(true);
  }, [recomputeFitZoom, themeMode]);

  useEffect(() => {
    setReady(false);
    setZoomMode("fit");
    setManualZoom(1);
    setFitZoom(1);
  }, [srcDoc]);

  useEffect(() => {
    if (!ready) return;
    syncZoomIntoIframe(displayZoom);
  }, [displayZoom, ready, syncZoomIntoIframe]);

  const themeModeRef = useRef(themeMode);
  useEffect(() => {
    const previousTheme = themeModeRef.current;
    themeModeRef.current = themeMode;
    if (!ready || previousTheme === themeMode) return;

    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    let cancelled = false;
    void (async () => {
      applyHtmlPreviewZoom(doc, 1);
      await renderMermaidDiagrams(doc.body, { themeMode });
      if (cancelled) return;
      const fitted = recomputeFitZoom();
      const applied =
        zoomModeRef.current === "fit"
          ? fitted
          : clampHtmlPreviewZoom(manualZoomRef.current);
      applyHtmlPreviewZoom(doc, applied);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, recomputeFitZoom, themeMode]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!iframeRef.current?.contentDocument?.body) return;
      const fitted = recomputeFitZoom();
      if (zoomModeRef.current === "fit") {
        syncZoomIntoIframe(fitted);
      }
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [recomputeFitZoom, syncZoomIntoIframe]);

  const applyWheelZoom = useCallback(
    (event: WheelEvent) => {
      if (!isHtmlPreviewZoomModifier(event)) return false;
      event.preventDefault();
      event.stopPropagation();

      const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1;
      const mode = zoomModeRef.current;
      const base = mode === "fit" ? fitZoomRef.current : manualZoomRef.current;
      const next = nextHtmlPreviewZoom(base, direction);
      setZoomMode("manual");
      zoomModeRef.current = "manual";
      setManualZoom(next);
      manualZoomRef.current = next;
      syncZoomIntoIframe(next);
      return true;
    },
    [syncZoomIntoIframe],
  );

  /**
   * While Cmd/Ctrl is held, make the iframe ignore pointer events so wheel
   * reaches the parent shell. WKWebView often swallows meta+wheel inside
   * nested documents before our iframe listeners can run.
   */
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const setPassThrough = (enabled: boolean) => {
      iframe.style.pointerEvents = enabled ? "none" : "";
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Meta" ||
        event.key === "Control" ||
        event.metaKey ||
        event.ctrlKey
      ) {
        setPassThrough(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        setPassThrough(false);
        return;
      }
      if (!event.metaKey && !event.ctrlKey) {
        setPassThrough(false);
      }
    };
    const onBlur = () => setPassThrough(false);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      setPassThrough(false);
    };
  }, [ready, srcDoc]);

  // Parent shell + iframe document/window (capture, non-passive).
  useEffect(() => {
    const shell = shellRef.current;
    const iframe = iframeRef.current;
    const cleanups: Array<() => void> = [];

    const onWheel = (event: WheelEvent) => {
      applyWheelZoom(event);
    };

    const shellCleanup = bindWheelZoomTarget(shell, onWheel);
    if (shellCleanup) cleanups.push(shellCleanup);

    if (ready) {
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow;
      const docCleanup = bindWheelZoomTarget(doc, onWheel);
      const winCleanup = bindWheelZoomTarget(win, onWheel);
      if (docCleanup) cleanups.push(docCleanup);
      if (winCleanup) cleanups.push(winCleanup);
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [applyWheelZoom, ready, srcDoc]);

  const zoomOut = () => {
    const base =
      zoomModeRef.current === "fit"
        ? fitZoomRef.current
        : manualZoomRef.current;
    const next = nextHtmlPreviewZoom(base, -1);
    setZoomMode("manual");
    zoomModeRef.current = "manual";
    setManualZoom(next);
  };

  const zoomIn = () => {
    const base =
      zoomModeRef.current === "fit"
        ? fitZoomRef.current
        : manualZoomRef.current;
    const next = nextHtmlPreviewZoom(base, 1);
    setZoomMode("manual");
    zoomModeRef.current = "manual";
    setManualZoom(next);
  };

  const zoomReset = () => {
    setZoomMode("manual");
    zoomModeRef.current = "manual";
    setManualZoom(1);
  };

  const zoomFit = () => {
    const fitted = recomputeFitZoom();
    setZoomMode("fit");
    zoomModeRef.current = "fit";
    setManualZoom(fitted);
    syncZoomIntoIframe(fitted);
  };

  const percentLabel = `${Math.round(displayZoom * 100)}%`;

  return (
    <div
      ref={shellRef}
      className="preview-html-document preview-html-document-frame w-full h-full min-h-0"
    >
      <iframe
        ref={iframeRef}
        className="preview-html-frame"
        title={title}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={() => {
          void enhanceIframeDocument();
        }}
      />
      <div
        className="preview-html-zoom-pill"
        role="toolbar"
        aria-label={t("preview_htmlZoomToolbar")}
      >
        <button
          type="button"
          className="preview-html-zoom-pill-btn"
          onClick={zoomOut}
          title={t("preview_htmlZoomOut")}
          aria-label={t("preview_htmlZoomOut")}
        >
          −
        </button>
        <button
          type="button"
          className="preview-html-zoom-pill-percent"
          onClick={zoomReset}
          onDoubleClick={(event) => {
            event.preventDefault();
            zoomFit();
          }}
          title={`${t("preview_htmlZoomReset")} / ${t("preview_htmlZoomFit")}`}
        >
          {percentLabel}
        </button>
        <button
          type="button"
          className="preview-html-zoom-pill-btn"
          onClick={zoomIn}
          title={t("preview_htmlZoomIn")}
          aria-label={t("preview_htmlZoomIn")}
        >
          +
        </button>
      </div>
    </div>
  );
};

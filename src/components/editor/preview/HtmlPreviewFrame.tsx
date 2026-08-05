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
  // Theme toggles need a Mermaid re-pass inside the iframe document.
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

  // Native non-passive listeners so Cmd/Ctrl+wheel can preventDefault.
  // Listen on both the shell and the iframe document (wheel does not bubble out).
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const onWheel = (event: WheelEvent) => {
      applyWheelZoom(event);
    };

    shell.addEventListener("wheel", onWheel, { passive: false });
    return () => shell.removeEventListener("wheel", onWheel);
  }, [applyWheelZoom]);

  useEffect(() => {
    if (!ready) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    const onWheel = (event: WheelEvent) => {
      applyWheelZoom(event);
    };

    doc.addEventListener("wheel", onWheel, { passive: false });
    return () => doc.removeEventListener("wheel", onWheel);
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
      className="preview-html-document preview-html-document-frame editor-pane-width-constrained mx-auto w-full h-full min-h-0"
    >
      <div
        className="preview-html-zoom-bar"
        role="toolbar"
        aria-label={t("preview_htmlZoomToolbar")}
      >
        <button
          type="button"
          className="preview-html-zoom-btn"
          onClick={zoomFit}
          title={t("preview_htmlZoomFit")}
        >
          {t("preview_htmlZoomFit")}
        </button>
        <button
          type="button"
          className="preview-html-zoom-btn"
          onClick={zoomOut}
          title={t("preview_htmlZoomOut")}
          aria-label={t("preview_htmlZoomOut")}
        >
          −
        </button>
        <button
          type="button"
          className="preview-html-zoom-btn preview-html-zoom-percent"
          onClick={zoomReset}
          title={t("preview_htmlZoomReset")}
        >
          {percentLabel}
        </button>
        <button
          type="button"
          className="preview-html-zoom-btn"
          onClick={zoomIn}
          title={t("preview_htmlZoomIn")}
          aria-label={t("preview_htmlZoomIn")}
        >
          +
        </button>
      </div>
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
    </div>
  );
};

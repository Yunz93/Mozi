import React, { useCallback, useMemo, useRef, useState } from "react";
import type { HeadingNode } from "../../utils/outline";
import { OutlinePanel } from "../outline/OutlinePanel";
import { LinksPanel } from "../backlinks/LinksPanel";
import { RelatedNotesPanel } from "../related/RelatedNotesPanel";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../hooks/useI18n";

const MIN_OUTLINE_WIDTH = 180;
const MAX_OUTLINE_WIDTH = 360;

interface RightRailProps {
  isOpen: boolean;
  headings: HeadingNode[];
  activeHeadingId: string | null;
  onHeadingClick: (id: string, line: number) => void;
  width: number;
  onWidthChange: (width: number) => void;
  onOpenPath: (path: string) => void;
  onCreateMissingNote?: (targetRaw: string) => void;
}

export const RightRail: React.FC<RightRailProps> = ({
  isOpen,
  headings,
  activeHeadingId,
  onHeadingClick,
  width,
  onWidthChange,
  onOpenPath,
  onCreateMissingNote,
}) => {
  const { t } = useI18n();
  const rightRailTab = useAppStore((s) => s.rightRailTab);
  const setRightRailTab = useAppStore((s) => s.setRightRailTab);
  const progress = useAppStore((s) => s.linkIndexProgress);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isOpen || window.innerWidth < 768) return;
      event.preventDefault();

      const handlePointerMove = (moveEvent: MouseEvent) => {
        const panelRect = panelRef.current?.getBoundingClientRect();
        const nextWidth =
          (panelRect?.right ?? window.innerWidth) - moveEvent.clientX;
        onWidthChange(
          Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, nextWidth)),
        );
      };

      const handlePointerUp = () => {
        document.removeEventListener("mousemove", handlePointerMove);
        document.removeEventListener("mouseup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handlePointerMove);
      document.addEventListener("mouseup", handlePointerUp);
    },
    [isOpen, onWidthChange],
  );

  const panelStyle = useMemo(
    () =>
      ({
        "--outline-width": `${width}px`,
      }) as React.CSSProperties,
    [width],
  );

  return (
    <div
      ref={panelRef}
      style={panelStyle}
      aria-hidden={!isOpen}
      className={`outline-panel right-rail ui-scaled relative bg-transparent ${
        isOpen ? "" : "is-closed"
      } ${isCollapsed ? "collapsed" : ""}`}
    >
      <div className="outline-header right-rail-header">
        <div className="right-rail-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={rightRailTab === "outline"}
            className={`right-rail-tab ${rightRailTab === "outline" ? "active" : ""}`}
            onClick={() => setRightRailTab("outline")}
            tabIndex={isOpen ? undefined : -1}
          >
            {t("outline_title")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightRailTab === "links"}
            className={`right-rail-tab ${rightRailTab === "links" ? "active" : ""}`}
            onClick={() => setRightRailTab("links")}
            tabIndex={isOpen ? undefined : -1}
          >
            {t("links_title")}
            {progress.phase === "building" || progress.phase === "updating" ? (
              <span className="right-rail-tab-dot" aria-hidden />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightRailTab === "related"}
            className={`right-rail-tab ${rightRailTab === "related" ? "active" : ""}`}
            onClick={() => setRightRailTab("related")}
            tabIndex={isOpen ? undefined : -1}
          >
            {t("related_tab")}
          </button>
        </div>
        <button
          className="collapse-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? t("outline_expand") : t("outline_collapse")}
          tabIndex={isOpen ? undefined : -1}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {isCollapsed ? (
              <polyline points="15 18 9 12 15 6" />
            ) : (
              <polyline points="9 18 15 12 9 6" />
            )}
          </svg>
        </button>
      </div>

      {!isCollapsed && (
        <div className="right-rail-content">
          {rightRailTab === "outline" ? (
            <OutlinePanel
              headings={headings}
              activeHeadingId={activeHeadingId}
              onHeadingClick={onHeadingClick}
              width={width}
              onWidthChange={onWidthChange}
              embedded
            />
          ) : rightRailTab === "links" ? (
            <LinksPanel
              onOpenPath={onOpenPath}
              onCreateMissingNote={onCreateMissingNote}
            />
          ) : (
            <RelatedNotesPanel onOpenPath={onOpenPath} />
          )}
        </div>
      )}

      {isOpen ? (
        <div
          className="workspace-resize-handle absolute inset-y-0 left-0 hidden w-1 cursor-col-resize md:block opacity-0 hover:opacity-100 transition-opacity"
          onMouseDown={handleResizeStart}
          aria-hidden
        >
          <div className="absolute left-0 top-0 h-full w-px bg-gray-300/50 dark:bg-white/10" />
        </div>
      ) : null}
    </div>
  );
};

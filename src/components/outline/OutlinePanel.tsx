import React, { useState, useRef, useCallback } from "react";
import type { HeadingNode } from "../../utils/outline";
import { useI18n } from "../../hooks/useI18n";

const MIN_OUTLINE_WIDTH = 180;
const MAX_OUTLINE_WIDTH = 360;

interface OutlinePanelProps {
  headings: HeadingNode[];
  activeHeadingId: string | null;
  onHeadingClick: (id: string, line: number) => void;
  width: number;
  onWidthChange: (width: number) => void;
  /** When true, render only the heading tree (parent owns chrome). */
  embedded?: boolean;
}

interface HeadingItemProps {
  node: HeadingNode;
  depth: number;
  activeId: string | null;
  onItemClick: (id: string, line: number) => void;
}

const HeadingItem: React.FC<HeadingItemProps> = ({
  node,
  depth,
  activeId,
  onItemClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div className="outline-item">
      <div
        className={`outline-node ${activeId === node.id ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 8 + 8}px` }}
      >
        {hasChildren ? (
          <button
            className={`expand-btn ${isExpanded ? "expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            <svg
              className="chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <span className="spacer" />
        )}
        <button
          className={`heading-text ${activeId === node.id ? "active" : ""}`}
          onClick={() => onItemClick(node.id, node.line!)}
          title={node.text}
        >
          <span className="heading-title">{node.text}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="children">
          {node.children.map((child) => (
            <HeadingItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onItemClick={onItemClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const OutlinePanel: React.FC<OutlinePanelProps> = React.memo(
  ({
    headings,
    activeHeadingId,
    onHeadingClick,
    width,
    onWidthChange,
    embedded = false,
  }) => {
    const { t } = useI18n();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const handleResizeStart = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (window.innerWidth < 768) return;

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
      [onWidthChange],
    );

    const tree = (
      <div className="outline-content">
        {headings.map((h) => (
          <HeadingItem
            key={h.id}
            node={h}
            depth={0}
            activeId={activeHeadingId}
            onItemClick={onHeadingClick}
          />
        ))}
      </div>
    );

    if (embedded) {
      if (headings.length === 0) {
        return <p className="empty-message">{t("outline_empty")}</p>;
      }
      return tree;
    }

    if (headings.length === 0) {
      return (
        <div
          ref={panelRef}
          className="outline-panel ui-scaled empty relative bg-transparent"
          style={{ width: `${width}px` }}
        >
          <div className="outline-header">
            <span className="title">{t("outline_title")}</span>
          </div>
          <p className="empty-message">{t("outline_empty")}</p>
          <div
            className="workspace-resize-handle absolute inset-y-0 left-0 hidden w-1 cursor-col-resize md:block opacity-0 hover:opacity-100 transition-opacity"
            onMouseDown={handleResizeStart}
            aria-hidden
          >
            <div className="absolute left-0 top-0 h-full w-px bg-gray-300/50 dark:bg-white/10" />
          </div>
        </div>
      );
    }

    return (
      <div
        ref={panelRef}
        className={`outline-panel ui-scaled relative bg-transparent ${isCollapsed ? "collapsed" : ""}`}
        style={{ width: `${width}px` }}
      >
        <div className="outline-header">
          <span className="title">{t("outline_title")}</span>
          <button
            className="collapse-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? t("outline_expand") : t("outline_collapse")}
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
        {!isCollapsed && tree}
        <div
          className="workspace-resize-handle absolute inset-y-0 left-0 hidden w-1 cursor-col-resize md:block opacity-0 hover:opacity-100 transition-opacity"
          onMouseDown={handleResizeStart}
          aria-hidden
        >
          <div className="absolute left-0 top-0 h-full w-px bg-gray-300/50 dark:bg-white/10" />
        </div>
      </div>
    );
  },
);

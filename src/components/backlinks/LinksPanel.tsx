import React, { useMemo, useState } from "react";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../hooks/useI18n";
import {
  getBacklinks,
  getOutbounds,
} from "../../services/vault/linkIndexService";
import type { WikiOutboundLink } from "../../types/vaultIndex";
import { resolveOutbounds } from "../../utils/wikiOutbound";
import { Dialog } from "../ui/Dialog";

function displayName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").pop() || normalized;
  return base.replace(/\.(md|markdown)$/i, "");
}

interface LinksPanelProps {
  onOpenPath: (path: string) => void;
  onCreateMissingNote?: (targetRaw: string) => void;
}

const LinkRow: React.FC<{
  label: string;
  meta?: string;
  danger?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ label, meta, danger, onClick, actionLabel, onAction }) => (
  <div className={`links-row ${danger ? "is-unresolved" : ""}`}>
    <button
      type="button"
      className="links-row-main"
      onClick={onClick}
      disabled={!onClick}
      title={label}
    >
      <span className="links-row-title">{label}</span>
      {meta ? <span className="links-row-meta">{meta}</span> : null}
    </button>
    {actionLabel && onAction ? (
      <button type="button" className="links-row-action" onClick={onAction}>
        {actionLabel}
      </button>
    ) : null}
  </div>
);

function formatOutboundMeta(link: WikiOutboundLink): string {
  const parts: string[] = [];
  if (link.isEmbed) parts.push("embed");
  if (link.subpath) parts.push(`#${link.subpath.replace(/^\^/, "^")}`);
  if (link.displayText && link.displayText !== link.targetRaw) {
    parts.push(link.displayText);
  }
  return parts.join(" · ");
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable scatter positions for the neighborhood graph. */
export function layoutScatterPoints(
  ids: string[],
  width: number,
  height: number,
  centerId: string,
  options?: { labeled?: boolean },
): Array<{ id: string; x: number; y: number }> {
  const labeled = options?.labeled ?? false;
  const padX = labeled ? 56 : 18;
  const padY = labeled ? 36 : 16;
  const minX = padX;
  const maxX = width - padX;
  const minY = padY;
  const maxY = height - padY;
  const points = ids.map((id) => {
    if (id === centerId) {
      return { id, x: width * 0.48, y: height * 0.46 };
    }
    const h = hashString(id);
    const x = minX + ((h % 1000) / 1000) * (maxX - minX);
    const y = minY + (((h >>> 10) % 1000) / 1000) * (maxY - minY);
    return { id, x, y };
  });

  const baseMinDist = labeled ? 72 : 28;
  const centerMinDist = labeled ? 88 : 34;
  const iterations = labeled ? 36 : 18;
  const pushScale = labeled ? 6 : 3.5;

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minDist =
          a.id === centerId || b.id === centerId ? centerMinDist : baseMinDist;
        if (dist >= minDist) continue;
        const push = ((minDist - dist) / minDist) * pushScale;
        dx = (dx / dist) * push;
        dy = (dy / dist) * push;
        if (a.id !== centerId) {
          a.x -= dx;
          a.y -= dy;
        }
        if (b.id !== centerId) {
          b.x += dx;
          b.y += dy;
        }
      }
    }
    for (const point of points) {
      if (point.id === centerId) continue;
      point.x = Math.min(maxX, Math.max(minX, point.x));
      point.y = Math.min(maxY, Math.max(minY, point.y));
    }
  }

  return points;
}

/** Shorten a segment so strokes stop at node radii instead of under the dots. */
export function shortenEdgeSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startInset: number,
  endInset: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist <= startInset + endInset + 0.5) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x1: x1 + ux * startInset,
    y1: y1 + uy * startInset,
    x2: x2 - ux * endInset,
    y2: y2 - uy * endInset,
  };
}

function nodeRadius(showLabels: boolean, isCurrent: boolean): number {
  if (showLabels) return isCurrent ? 7 : 5.5;
  return isCurrent ? 5.5 : 4.5;
}

export const NeighborhoodGraph: React.FC<{
  centerPath: string;
  nodes: Array<{ path: string; kind: "in" | "out" }>;
  onOpenPath?: (path: string) => void;
  showLabels?: boolean;
  width?: number;
  height?: number;
  className?: string;
  onSurfaceClick?: () => void;
  ariaLabel?: string;
}> = ({
  centerPath,
  nodes,
  onOpenPath,
  showLabels = true,
  width = 260,
  height = 200,
  className = "links-neighborhood-graph",
  onSurfaceClick,
  ariaLabel,
}) => {
  const ids = useMemo(
    () => [centerPath, ...nodes.map((node) => node.path)],
    [centerPath, nodes],
  );
  const points = useMemo(
    () =>
      layoutScatterPoints(ids, width, height, centerPath, {
        labeled: showLabels,
      }),
    [ids, centerPath, width, height, showLabels],
  );
  const pointById = useMemo(() => {
    const map = new Map<string, { id: string; x: number; y: number }>();
    for (const point of points) map.set(point.id, point);
    return map;
  }, [points]);
  const kindByPath = useMemo(() => {
    const map = new Map<string, "in" | "out">();
    for (const node of nodes) map.set(node.path, node.kind);
    return map;
  }, [nodes]);
  const centerPoint = pointById.get(centerPath);
  const centerR = nodeRadius(showLabels, true);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role={onSurfaceClick ? "button" : "img"}
      tabIndex={onSurfaceClick ? 0 : undefined}
      aria-label={ariaLabel ?? displayName(centerPath)}
      onClick={
        onSurfaceClick
          ? (event) => {
              event.preventDefault();
              onSurfaceClick();
            }
          : undefined
      }
      onKeyDown={
        onSurfaceClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSurfaceClick();
              }
            }
          : undefined
      }
      style={onSurfaceClick ? { cursor: "pointer" } : undefined}
    >
      {centerPoint
        ? nodes.map((node) => {
            const target = pointById.get(node.path);
            if (!target) return null;
            const neighborR = nodeRadius(showLabels, false);
            const segment = shortenEdgeSegment(
              centerPoint.x,
              centerPoint.y,
              target.x,
              target.y,
              centerR,
              neighborR,
            );
            if (!segment) return null;
            return (
              <line
                key={`edge:${node.path}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                className={
                  node.kind === "in"
                    ? "links-neighborhood-edge is-in"
                    : "links-neighborhood-edge is-out"
                }
              />
            );
          })
        : null}
      {points.map((point) => {
        const isCurrent = point.id === centerPath;
        const kind = kindByPath.get(point.id);
        const label = displayName(point.id);
        const labelY = point.y + (point.y > height * 0.78 ? -14 : 18);
        const canOpen = Boolean(onOpenPath) && !isCurrent && !onSurfaceClick;
        const nodeClass = isCurrent
          ? "links-neighborhood-node is-current"
          : kind === "in"
            ? "links-neighborhood-node is-in"
            : kind === "out"
              ? "links-neighborhood-node is-out"
              : "links-neighborhood-node";
        return (
          <g
            key={point.id}
            className={
              isCurrent
                ? "links-neighborhood-item is-current"
                : "links-neighborhood-item"
            }
            onClick={
              canOpen
                ? (event) => {
                    event.stopPropagation();
                    onOpenPath?.(point.id);
                  }
                : undefined
            }
            style={{ cursor: canOpen ? "pointer" : undefined }}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={nodeRadius(showLabels, isCurrent)}
              className={nodeClass}
            >
              <title>{label}</title>
            </circle>
            {showLabels ? (
              <text
                x={point.x}
                y={labelY}
                textAnchor="middle"
                className={
                  isCurrent
                    ? "links-neighborhood-label is-current"
                    : "links-neighborhood-label"
                }
              >
                {label.length > 22 ? `${label.slice(0, 22)}…` : label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

export const LinksPanel: React.FC<LinksPanelProps> = ({
  onOpenPath,
  onCreateMissingNote,
}) => {
  const { t } = useI18n();
  const currentFilePath = useAppStore((s) => s.currentFilePath);
  const linkIndex = useAppStore((s) => s.linkIndex);
  const files = useAppStore((s) => s.files);
  const rootFolderPath = useAppStore((s) => s.rootFolderPath);
  const progress = useAppStore((s) => s.linkIndexProgress);
  const [neighborhoodOpen, setNeighborhoodOpen] = useState(false);

  const backlinks = useMemo(
    () => getBacklinks(linkIndex, currentFilePath),
    [linkIndex, currentFilePath],
  );
  // Re-resolve against the live file tree so newly added notes are not stuck
  // in "unresolved" until the next full index rebuild.
  const outbounds = useMemo(() => {
    const stored = getOutbounds(linkIndex, currentFilePath);
    if (stored.length === 0) return stored;
    return resolveOutbounds(
      stored.map(({ resolvedPath: _resolved, ...rest }) => rest),
      files,
      rootFolderPath,
    );
  }, [linkIndex, currentFilePath, files, rootFolderPath]);
  const unresolved = useMemo(
    () => outbounds.filter((link) => link.resolvedPath === null),
    [outbounds],
  );
  const resolvedOutbounds = useMemo(
    () => outbounds.filter((link) => link.resolvedPath !== null),
    [outbounds],
  );

  const neighborhood = useMemo(() => {
    if (!currentFilePath) {
      return {
        center: "",
        nodes: [] as Array<{ path: string; kind: "in" | "out" }>,
      };
    }
    const nodes: Array<{ path: string; kind: "in" | "out" }> = [];
    const seen = new Set<string>();
    const center = currentFilePath.replace(/\\/g, "/");
    for (const group of backlinks) {
      const path = group.sourcePath.replace(/\\/g, "/");
      if (seen.has(path)) continue;
      seen.add(path);
      nodes.push({ path: group.sourcePath, kind: "in" });
    }
    for (const link of resolvedOutbounds) {
      const path = link.resolvedPath!.replace(/\\/g, "/");
      if (path === center || seen.has(path)) continue;
      seen.add(path);
      nodes.push({ path: link.resolvedPath!, kind: "out" });
    }
    return { center: currentFilePath, nodes: nodes.slice(0, 8) };
  }, [backlinks, currentFilePath, resolvedOutbounds]);

  if (!currentFilePath) {
    return <p className="empty-message">{t("links_noFile")}</p>;
  }

  if (progress.phase === "building" && !linkIndex) {
    return (
      <p className="empty-message">
        {t("links_building", {
          done: progress.done,
          total: Math.max(progress.total, 1),
        })}
      </p>
    );
  }

  return (
    <div className="links-panel-body">
      {neighborhood.nodes.length > 0 ? (
        <section className="links-section">
          <h3 className="links-section-title">
            {t("links_neighborhood")}
            <span className="links-count">{neighborhood.nodes.length}</span>
          </h3>
          <div className="links-neighborhood-compact">
            <NeighborhoodGraph
              centerPath={neighborhood.center}
              nodes={neighborhood.nodes}
              showLabels={false}
              width={260}
              height={168}
              onSurfaceClick={() => setNeighborhoodOpen(true)}
              ariaLabel={t("links_neighborhoodExpand")}
            />
            <p className="links-neighborhood-hint">
              {t("links_neighborhoodExpandHint")}
            </p>
          </div>
          <Dialog
            isOpen={neighborhoodOpen}
            onClose={() => setNeighborhoodOpen(false)}
            title={t("links_neighborhoodDialog")}
            className="max-w-3xl"
            contentScroll={false}
          >
            <NeighborhoodGraph
              centerPath={neighborhood.center}
              nodes={neighborhood.nodes}
              showLabels
              width={720}
              height={480}
              className="links-neighborhood-graph is-expanded"
              onOpenPath={(path) => {
                setNeighborhoodOpen(false);
                onOpenPath(path);
              }}
              ariaLabel={t("links_neighborhoodDialog")}
            />
          </Dialog>
        </section>
      ) : null}

      <section className="links-section">
        <h3 className="links-section-title">
          {t("links_backlinks")}
          <span className="links-count">{backlinks.length}</span>
        </h3>
        {backlinks.length === 0 ? (
          <p className="links-empty">{t("links_backlinksEmpty")}</p>
        ) : (
          backlinks.map((group) => (
            <LinkRow
              key={group.sourcePath}
              label={displayName(group.sourcePath)}
              meta={group.links.map((l) => l.raw).join(" ")}
              onClick={() => onOpenPath(group.sourcePath)}
            />
          ))
        )}
      </section>

      <section className="links-section">
        <h3 className="links-section-title">
          {t("links_outbounds")}
          <span className="links-count">{resolvedOutbounds.length}</span>
        </h3>
        {resolvedOutbounds.length === 0 ? (
          <p className="links-empty">{t("links_outboundsEmpty")}</p>
        ) : (
          resolvedOutbounds.map((link, index) => (
            <LinkRow
              key={`${link.raw}-${link.startOffset}-${index}`}
              label={displayName(link.resolvedPath || link.targetRaw)}
              meta={formatOutboundMeta(link)}
              onClick={
                link.resolvedPath
                  ? () => onOpenPath(link.resolvedPath!)
                  : undefined
              }
            />
          ))
        )}
      </section>

      <section className="links-section">
        <h3 className="links-section-title">
          {t("links_unresolved")}
          <span className="links-count">{unresolved.length}</span>
        </h3>
        {unresolved.length === 0 ? (
          <p className="links-empty">{t("links_unresolvedEmpty")}</p>
        ) : (
          unresolved.map((link, index) => (
            <LinkRow
              key={`${link.raw}-${link.startOffset}-u-${index}`}
              label={link.targetRaw || link.raw}
              meta={link.raw}
              danger
              actionLabel={
                onCreateMissingNote ? t("links_createNote") : undefined
              }
              onAction={
                onCreateMissingNote && link.targetRaw.trim()
                  ? () => onCreateMissingNote(link.targetRaw.trim())
                  : undefined
              }
            />
          ))
        )}
      </section>
    </div>
  );
};

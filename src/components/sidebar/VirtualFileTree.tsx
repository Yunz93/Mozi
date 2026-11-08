import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { FileNode } from "../../types";
import { FileTreeItem, type FileTreeItemProps } from "./FileTree";

const OVERSCAN = 6;
const ROW_GAP = 2;
const sortedChildren = new WeakMap<FileNode[], FileNode[]>();
const EMPTY_NODES: FileNode[] = [];

function childrenOf(node: FileNode): FileNode[] {
  const children = node.children ?? EMPTY_NODES;
  let sorted = sortedChildren.get(children);
  if (!sorted) {
    sorted = children
      .filter((child) => !child.isTrash)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    sortedChildren.set(children, sorted);
  }
  return sorted;
}

interface Props extends Omit<
  FileTreeItemProps,
  "node" | "level" | "expanded" | "onExpandedChange"
> {
  forceExpanded?: boolean;
  expandedPathIds?: Set<string>;
  locateRequestKey?: number;
  nodes: FileNode[];
  scrollElementRef: RefObject<HTMLDivElement | null>;
}

/** Keep expansion state outside rows, which unmount as they leave the viewport. */
export function VirtualFileTree({
  nodes,
  scrollElementRef,
  activeId,
  expandedPathIds,
  locateRequestKey = 0,
  forceExpanded = false,
  ...itemProps
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [viewport, setViewport] = useState({ top: 0, height: 600, padding: 0 });
  const [rowHeight, setRowHeight] = useState(38);
  const hostRef = useRef<HTMLDivElement>(null);
  const pendingLocateRef = useRef(false);
  const lastLocateRef = useRef({ key: 0, id: activeId });

  const onExpandedChange = useCallback((id: string, value: boolean) => {
    setExpanded((previous) => {
      if (previous.has(id) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const rows = useMemo(() => {
    const result: { node: FileNode; level: number }[] = [];
    const visit = (entries: FileNode[], level: number) => {
      for (const node of entries) {
        if (node.isTrash) continue;
        result.push({ node, level });
        if (
          node.type === "folder" &&
          (forceExpanded || expanded.has(node.id))
        ) {
          visit(childrenOf(node), level + 1);
        }
      }
    };
    // The sidebar already sorts root entries (folders first).
    visit(nodes, 0);
    return result;
  }, [nodes, expanded, forceExpanded]);

  const virtual = rows.length > 200;
  const visibleCount = Math.ceil(viewport.height / rowHeight);
  const first = virtual
    ? Math.max(
        0,
        Math.min(
          Math.floor(Math.max(0, viewport.top - viewport.padding) / rowHeight) -
            OVERSCAN,
          rows.length - visibleCount,
        ),
      )
    : 0;
  const end = virtual
    ? Math.min(rows.length, first + visibleCount + OVERSCAN * 2)
    : rows.length;

  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element) return;
    const measure = () => {
      const next = {
        top: element.scrollTop,
        height: element.clientHeight || 600,
        padding: Number.parseFloat(getComputedStyle(element).paddingTop) || 0,
      };
      setViewport((previous) =>
        previous.top === next.top &&
        previous.height === next.height &&
        previous.padding === next.padding
          ? previous
          : next,
      );
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scrollElementRef]);

  useLayoutEffect(() => {
    const row = hostRef.current?.querySelector<HTMLElement>(
      "[data-file-tree-item]",
    );
    if (!row) return;
    // offsetHeight stays in CSS pixels and includes the user's UI font sizing.
    const measure = () => {
      if (row.offsetHeight > 0) setRowHeight(row.offsetHeight + ROW_GAP);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [first, nodes, virtual]);

  useLayoutEffect(() => {
    if (
      locateRequestKey <= 0 ||
      (lastLocateRef.current.key === locateRequestKey &&
        lastLocateRef.current.id === activeId)
    )
      return;
    lastLocateRef.current = { key: locateRequestKey, id: activeId };
    pendingLocateRef.current = true;
    setExpanded((previous) => {
      if (
        !expandedPathIds ||
        [...expandedPathIds].every((id) => previous.has(id))
      )
        return previous;
      return new Set([...previous, ...expandedPathIds]);
    });
  }, [activeId, expandedPathIds, locateRequestKey]);

  useLayoutEffect(() => {
    if (!pendingLocateRef.current) return;
    const index = rows.findIndex(({ node }) => node.id === activeId);
    const element = scrollElementRef.current;
    if (index < 0 || !element) return;
    element.scrollTop = Math.max(
      0,
      index * rowHeight + viewport.padding - (viewport.height - rowHeight) / 2,
    );
    setViewport((previous) => ({ ...previous, top: element.scrollTop }));
    pendingLocateRef.current = false;
  }, [
    activeId,
    locateRequestKey,
    rows,
    rowHeight,
    scrollElementRef,
    viewport.height,
    viewport.padding,
  ]);

  return (
    <div
      ref={hostRef}
      data-virtual-file-tree
      data-tree-total={rows.length}
      style={
        virtual
          ? { position: "relative", height: rows.length * rowHeight - ROW_GAP }
          : undefined
      }
    >
      {rows.slice(first, end).map(({ node, level }, offset) => (
        <div
          key={node.id}
          style={
            virtual
              ? {
                  position: "absolute",
                  top: (first + offset) * rowHeight,
                  width: "100%",
                }
              : { marginBottom: ROW_GAP }
          }
        >
          <FileTreeItem
            {...itemProps}
            node={node}
            level={level}
            activeId={activeId}
            expanded={forceExpanded || expanded.has(node.id)}
            onExpandedChange={onExpandedChange}
          />
        </div>
      ))}
    </div>
  );
}

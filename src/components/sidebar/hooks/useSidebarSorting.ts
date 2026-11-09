import { useEffect, useRef, useState } from "react";
import type { FileNode } from "../../../types";
import {
  getFileSystem,
  type FileEntryMetadata,
} from "../../../types/filesystem";
import { useAppStore } from "../../../store/appStore";
import { normalizeFileSortMode } from "../fileSorting";
import { FILE_METADATA_CHANGED_EVENT } from "../../../services/filesystem/fileMetadataEvents";

export function useSidebarSorting(files: FileNode[]) {
  const mode = normalizeFileSortMode(
    useAppStore((state) => state.settings.sidebarSortMode),
  );
  const saved = useAppStore((state) => state.lastSavedContent);
  const previous = useRef({ files: null as FileNode[] | null, saved, mode });
  const [metadata, setMetadata] = useState(
    new Map<string, FileEntryMetadata>(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loaded = useRef(false);
  const pending = useRef(new Set<string>());
  const generation = useRef(0);
  const forceFull = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const invalidate = (event: Event) => {
      const paths = (event as CustomEvent<unknown>).detail;
      if (!Array.isArray(paths)) return;
      for (const path of paths)
        if (typeof path === "string") pending.current.add(path);
      generation.current += 1;
      setRevision((value) => value + 1);
    };
    const focus = () => {
      forceFull.current = true;
      generation.current += 1;
      setRevision((value) => value + 1);
    };
    window.addEventListener(FILE_METADATA_CHANGED_EVENT, invalidate);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener(FILE_METADATA_CHANGED_EVENT, invalidate);
      window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    const before = previous.current;
    previous.current = { files, saved, mode };
    if (mode !== "created" && mode !== "modified") {
      setLoading(false);
      setError(false);
      return;
    }
    const paths: string[] = [];
    const full =
      forceFull.current ||
      !loaded.current ||
      before.files !== files ||
      before.mode !== mode;
    if (full) loaded.current = false;
    const collect = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.isTrash) continue;
        if (saved?.[node.id] !== before.saved?.[node.id])
          pending.current.add(node.path);
        if (full || pending.current.has(node.path)) paths.push(node.path);
        if (node.children) collect(node.children);
      }
    };
    collect(files);
    if (!paths.length) {
      if (full) {
        loaded.current = true;
        forceFull.current = false;
        pending.current.clear();
        setMetadata(new Map());
      }
      setLoading(false);
      setError(false);
      return;
    }
    let active = true;
    let completed = false;
    const request = ++generation.current;
    const current = () => active && request === generation.current;
    setLoading(true);
    setError(false);
    void (async () => {
      const fs = await getFileSystem();
      if (!fs.fileMetadata) throw new Error("File metadata unavailable");
      const entries = new Map<string, FileEntryMetadata>();
      // 限定每次 IPC 的路径数量，且不读取附件内容。
      for (let offset = 0; offset < paths.length && current(); offset += 512) {
        const batch = await fs.fileMetadata(paths.slice(offset, offset + 512));
        for (const [path, value] of Object.entries(batch))
          entries.set(path, value);
      }
      if (current()) {
        loaded.current = true;
        forceFull.current = false;
        completed = true;
        if (full) pending.current.clear();
        else paths.forEach((path) => pending.current.delete(path));
        setMetadata(
          (current) => new Map([...(full ? [] : current), ...entries]),
        );
      }
    })()
      .catch(() => {
        if (current()) {
          loaded.current = false;
          setMetadata(new Map());
          setError(true);
        }
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      active = false;
      if (!completed) loaded.current = false;
    };
  }, [files, mode, saved, revision]);
  return { mode, metadata, loading, error };
}

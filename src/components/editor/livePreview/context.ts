import { Facet } from "@codemirror/state";
import type { FileNode, MarkdownStylePreset, ThemeMode } from "../../../types";
import type { ShikiHighlighter } from "../../../hooks/useShikiHighlighter";

export interface LivePreviewContext {
  sourceFilePath: string | null;
  rootFolderPath: string | null;
  files: FileNode[];
  /** Open a wiki target (path, optional #heading / #^block). */
  onOpenWiki?: (wikiTarget: string) => void | Promise<void>;
  /** Open an external or local markdown link destination. */
  onOpenLink?: (href: string) => void | Promise<void>;
  /** Sync/async note body lookup for embeds (by absolute file path). */
  getFileContent?: (filePath: string) => string | null | Promise<string | null>;
  themeMode?: ThemeMode;
  markdownStylePreset?: MarkdownStylePreset;
  highlighter?: ShikiHighlighter | null;
}

export const EMPTY_LIVE_PREVIEW_CONTEXT: LivePreviewContext = {
  sourceFilePath: null,
  rootFolderPath: null,
  files: [],
};

export const livePreviewContextFacet = Facet.define<
  LivePreviewContext,
  LivePreviewContext
>({
  combine(values) {
    return values.length > 0
      ? values[values.length - 1]!
      : EMPTY_LIVE_PREVIEW_CONTEXT;
  },
});

import type {
  FileNode,
  MarkdownStylePreset,
  OrderedListMode,
  AppLanguage,
} from "../../types";
import type { FontSettings } from "../fontSettings";
import type { ShikiHighlighter } from "../../hooks/useShikiHighlighter";

/** Vault file tree context for resolving wiki embeds and attachment paths during export. */
export type ExportAttachmentContext = {
  files: FileNode[];
  rootFolderPath: string | null;
};

export interface ExportOptions {
  title?: string;
  theme?: "light" | "dark";
  includeTOC?: boolean;
  fontFamily?: string;
  codeFontFamily?: string;
  fontSettings?: FontSettings;
  fontSize?: number;
  codeFontSize?: number;
  includeProperties?: boolean;
  highlighter?: ShikiHighlighter | null;
  markdownStylePreset?: MarkdownStylePreset;
  orderedListMode?: OrderedListMode;
  language?: AppLanguage;
}

export interface SaveExportOptions {
  content: string | Uint8Array;
  filename: string;
  defaultExtension: string;
  mimeType: string;
  description: string;
}

/** Comfortable-medium preview sheet width (`getPaneLayoutMetrics(920)`). */
export const PREVIEW_PANEL_WIDTH_PX = 920;

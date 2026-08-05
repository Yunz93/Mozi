export type FileIconKind =
  | "markdown"
  | "image"
  | "pdf"
  | "text"
  | "spreadsheet"
  | "presentation"
  | "archive"
  | "audio"
  | "video"
  | "code"
  | "excalidraw"
  | "file";

const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const IMAGE = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "heic",
  "heif",
  "tiff",
  "tif",
]);
const TEXT = new Set(["txt", "log", "text", "csv", "tsv", "rtf"]);
const SPREADSHEET = new Set(["xls", "xlsx", "ods", "numbers"]);
const PRESENTATION = new Set(["ppt", "pptx", "key"]);
const ARCHIVE = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "lz4",
  "zst",
]);
const AUDIO = new Set([
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "m4a",
  "wma",
  "opus",
  "aiff",
  "alac",
]);
const VIDEO = new Set([
  "mp4",
  "webm",
  "mkv",
  "mov",
  "avi",
  "m4v",
  "wmv",
  "mpeg",
  "mpg",
  "ogv",
]);
const CODE = new Set([
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "php",
  "rb",
  "swift",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "vue",
  "svelte",
  "astro",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "env",
  "graphql",
  "gql",
  "wasm",
  "r",
  "dart",
  "ex",
  "exs",
  "elm",
  "clj",
  "cljs",
  "fs",
  "fsx",
  "scala",
  "pl",
  "pm",
  "lua",
  "vim",
  "zig",
]);

export function getFileExtension(fileName: string): string | null {
  const base = fileName.trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function getFileIconKind(fileName: string): FileIconKind {
  const base = fileName.trim().toLowerCase();
  if (
    base.endsWith(".excalidraw") ||
    base.endsWith(".excalidraw.json") ||
    base.endsWith(".excalidraw.md")
  ) {
    return "excalidraw";
  }

  const ext = getFileExtension(fileName);
  if (!ext) return "file";

  if (MARKDOWN.has(ext)) return "markdown";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (TEXT.has(ext)) return "text";
  if (SPREADSHEET.has(ext)) return "spreadsheet";
  if (PRESENTATION.has(ext)) return "presentation";
  if (ARCHIVE.has(ext)) return "archive";
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  if (CODE.has(ext)) return "code";
  return "file";
}

/**
 * Compact uppercase type badge for the file tree (e.g. MD / PDF / PNG).
 * Returns null when the name has no usable extension.
 */
export function getFileTypeBadge(fileName: string): string | null {
  const kind = getFileIconKind(fileName);
  if (kind === "markdown") return "MD";
  if (kind === "excalidraw") return "DRAW";

  const ext = getFileExtension(fileName);
  if (!ext) return null;

  const badge = ext.toUpperCase();
  return badge.length > 5 ? badge.slice(0, 4) : badge;
}

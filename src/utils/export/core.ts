import { isTauriEnvironment } from "../../types/filesystem";
import type { SaveExportOptions } from "./types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ensureFileExtension(
  filename: string,
  extension: string,
): string {
  const baseFilename = filename.replace(/\.md$/i, "");
  const normalizedExtension = extension.startsWith(".")
    ? extension
    : `.${extension}`;
  return baseFilename.toLowerCase().endsWith(normalizedExtension.toLowerCase())
    ? baseFilename
    : `${baseFilename}${normalizedExtension}`;
}

export function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.message.toLowerCase().includes("aborted")
  );
}

/**
 * Returns the saved file path on success (Tauri), empty string for browser saves, or null if cancelled.
 */
export async function saveExportFile({
  content,
  filename,
  defaultExtension,
  mimeType,
  description,
}: SaveExportOptions): Promise<string | null> {
  const suggestedName = ensureFileExtension(filename, defaultExtension);

  if (isTauriEnvironment()) {
    const [{ save }, { writeFile, writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const targetPath = await save({
      defaultPath: suggestedName,
      filters: [
        {
          name: description,
          extensions: [defaultExtension.replace(/^\./, "")],
        },
      ],
    });

    if (!targetPath) {
      return null;
    }

    if (typeof content === "string") {
      await writeTextFile(targetPath, content);
    } else {
      await writeFile(targetPath, content);
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("register_allowed_path", {
        path: targetPath,
        recursive: false,
      });
    } catch {
      // 注册失败不阻断导出；Finder 显示仍可能失败
    }
    return targetPath;
  }

  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await (
        window as Window & {
          showSaveFilePicker: (options?: {
            suggestedName?: string;
            types?: Array<{
              description?: string;
              accept: Record<string, string[]>;
            }>;
          }) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description,
            accept: {
              [mimeType]: [
                defaultExtension.startsWith(".")
                  ? defaultExtension
                  : `.${defaultExtension}`,
              ],
            },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return "";
    } catch (error) {
      if (isAbortLikeError(error)) {
        return null;
      }

      throw error;
    }
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return "";
}

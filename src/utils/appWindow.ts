import { isTauriEnvironment } from "../types/filesystem";

export type AppWindowKind = "main" | "file" | "window" | "other";

export function classifyWindowLabel(
  label: string | null | undefined,
): AppWindowKind {
  if (!label) return "other";
  if (label === "main") return "main";
  if (label.startsWith("file-")) return "file";
  if (label.startsWith("win-")) return "window";
  return "other";
}

export function isPrimaryAppWindow(label: string | null | undefined): boolean {
  return classifyWindowLabel(label) === "main";
}

export async function getCurrentAppWindowLabel(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

/** Open a blank app window that restores the last knowledge base. */
export async function openNewAppWindow(): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error("New windows are only available in the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_new_window");
}

/** Open a note/drawing path in a dedicated desktop window. */
export async function openPathInNewAppWindow(path: string): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error("New windows are only available in the desktop app.");
  }
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Missing file path.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_file_in_new_window", { path: trimmed });
}

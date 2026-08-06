import type { ShortcutConfig } from "../types";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(
    navigator.platform || navigator.userAgent,
  );
}

export function getPreferredShortcutModifierToken(): "Cmd" | "Ctrl" {
  return isMacPlatform() ? "Cmd" : "Ctrl";
}

export function getDisplayShortcutModifierLabel(): "Cmd" | "Ctrl" {
  return isMacPlatform() ? "Cmd" : "Ctrl";
}

function isModifierToken(normalized: string): boolean {
  return (
    normalized === "ctrl" ||
    normalized === "control" ||
    normalized === "cmd" ||
    normalized === "command" ||
    normalized === "meta"
  );
}

/** Rewrite every Ctrl/Cmd-family modifier token in `shortcut` to `replacement`. */
function replaceModifierTokens(shortcut: string, replacement: string): string {
  return shortcut
    .split("+")
    .map((part) =>
      isModifierToken(part.trim().toLowerCase()) ? replacement : part.trim(),
    )
    .filter(Boolean)
    .join("+");
}

export function normalizeShortcutForPlatform(shortcut: string): string {
  return replaceModifierTokens(shortcut, getPreferredShortcutModifierToken());
}

export function normalizeShortcutConfigForPlatform(
  shortcuts: ShortcutConfig,
): ShortcutConfig {
  return Object.fromEntries(
    Object.entries(shortcuts).map(([key, value]) => [
      key,
      normalizeShortcutForPlatform(value),
    ]),
  ) as unknown as ShortcutConfig;
}

export function formatShortcutForDisplay(shortcut: string): string {
  return replaceModifierTokens(shortcut, getDisplayShortcutModifierLabel());
}

/**
 * Format shortcuts for UI chips and drop Cmd/Ctrl duplicates that collapse to
 * the same platform label (e.g. `Cmd+-` and `Ctrl+-` both become `Cmd+-` on macOS).
 */
export function uniqueFormattedShortcuts(
  shortcuts: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const shortcut of shortcuts) {
    const label = formatShortcutForDisplay(shortcut);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * Maps a keydown to the non-modifier token used in stored shortcuts, aligned with
 * {@link ../hooks/useKeyboardShortcuts} matching rules.
 */
function primaryShortcutTokenFromKeyEvent(
  key: string,
  code: string,
): string | null {
  if (key === " ") return null;

  if (key.length === 1) {
    if (/[a-zA-Z]/.test(key)) return key.toUpperCase();
    if (/[0-9]/.test(key)) return key;
    return key;
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
    return `F${key.replace(/^F/i, "")}`;
  }

  const knownMulti = new Set([
    "Enter",
    "Escape",
    "Backspace",
    "Tab",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    "Insert",
    "Delete",
    "IntlBackslash",
  ]);
  if (knownMulti.has(key)) return key;

  if (key === "OS") return null;

  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Backquote") return "`";
  if (code === "Backslash") return "\\";
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  if (code === "Comma") return ",";
  if (code === "Period") return ".";
  if (code === "Slash") return "/";

  return null;
}

/**
 * Builds a normalized shortcut string from a keydown event, or null if the chord is incomplete or unsupported.
 * Requires Cmd/Ctrl/Alt (or function key alone) for typical bindings so plain typing is not captured.
 */
export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (event.repeat) return null;

  const { key, code } = event;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta")
    return null;
  if (key === "Unidentified" || key === "Dead") return null;

  const preferred = getPreferredShortcutModifierToken();
  const parts: string[] = [];

  if (event.metaKey || event.ctrlKey) {
    parts.push(preferred);
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.altKey) {
    parts.push("Alt");
  }

  const hasAccel = event.metaKey || event.ctrlKey || event.altKey;

  const main = primaryShortcutTokenFromKeyEvent(key, code);
  if (!main) return null;

  const isFnKey = /^F([1-9]|1[0-9]|2[0-4])$/i.test(main);

  if (!hasAccel && !isFnKey) {
    const isAlnum = main.length === 1 && /[A-Z0-9]/.test(main);
    if (isAlnum) return null;
  }

  const joined = [...parts, main].join("+");
  return normalizeShortcutForPlatform(joined);
}

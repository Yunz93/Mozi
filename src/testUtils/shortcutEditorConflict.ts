import { defaultKeymap } from "@codemirror/commands";
import { createMarkdownKeyBindings } from "../components/editor/behavior";
import { defaultSettings } from "../store/uiStore";

/** 把编辑器 keymap / 全局快捷键统一成 `mod+shift+k` 形式以便求交。 */
export function normalizeShortcutChord(input: string): string {
  const parts = input
    .split(/[+\-]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const mods = new Set<string>();
  let key = "";
  for (const part of parts) {
    if (
      part === "mod" ||
      part === "cmd" ||
      part === "command" ||
      part === "meta" ||
      part === "ctrl" ||
      part === "control"
    ) {
      mods.add("mod");
    } else if (part === "shift") {
      mods.add("shift");
    } else if (part === "alt" || part === "option") {
      mods.add("alt");
    } else {
      key = part;
    }
  }

  return [...mods].sort().concat(key).join("+");
}

function bindingChords(
  bindings: ReadonlyArray<{
    key?: string;
    mac?: string;
    win?: string;
    linux?: string;
  }>,
): string[] {
  return bindings
    .flatMap((binding) =>
      [binding.key, binding.mac, binding.win, binding.linux].filter(
        (value): value is string => Boolean(value),
      ),
    )
    .map(normalizeShortcutChord)
    .filter(Boolean);
}

export function collectEditorKeymapChords(): string[] {
  return [
    ...bindingChords(createMarkdownKeyBindings("strict")),
    // CodeMirror 默认 keymap 里与 D1 相关的是带 Shift 的组合；
    // Mod-n 等单字母绑定是既有全局「新建笔记」占用，不纳入本次冲突集。
    ...bindingChords(defaultKeymap).filter((chord) => chord.includes("shift")),
  ];
}

export function collectDefaultGlobalShortcutChords(): string[] {
  return Object.values(defaultSettings.shortcuts)
    .map(normalizeShortcutChord)
    .filter(Boolean);
}

export function findDefaultShortcutEditorConflicts(): string[] {
  const editor = new Set(collectEditorKeymapChords());
  return [
    ...new Set(
      collectDefaultGlobalShortcutChords().filter((chord) => editor.has(chord)),
    ),
  ];
}
